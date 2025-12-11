#  Low-Level Design (LLD) & Protocol Specification

This document details the internal logic, class structures, data models, and communication protocols used in the **Collaborative Text Editor (CTE)**. It serves as a technical reference for developers to understand how the system handles state, persistence, and real-time messaging.

---

## 1. Backend Class Design

The core business logic is encapsulated in the **`DocumentSession`** class. Each active document has exactly one instance of this class running in memory on the backend.

### **Class: `DocumentSession`**
**Location:** `backend/src/services/DocumentSession.ts`

**Responsibilities:**
1.  Manages the list of connected users (Sockets + Metadata).
2.  Handles **Operational Transformation (OT)** conflicts (Last-Write-Wins granularity).
3.  Throttles **Version History** snapshots (10-minute lock mechanism).
4.  Persists state to **Redis** (Hot Storage) and **Kafka** (Cold Storage).

#### **Properties**
| Property | Type | Description |
| :--- | :--- | :--- |
| `documentId` | `string` | Unique identifier for the document (e.g., "Project-Alpha"). |
| `connections` | `Map<string, UserState>` | Tracks active sockets. Key is a unique `connectionId` (not userId, to allow multiple tabs). |
| `redisClient` | `Redis` | Connection to the Redis database. |
| `kafkaProducer` | `Kafka` | Connection to the Kafka event stream. |

#### **Key Methods**
| Method | Description |
| :--- | :--- |
| **`addUser(socket, userId, role)`** | Registers a new connection. Assigns a stable color based on `userId`. Sends initial `sync`, `chat_history`, and `access_info` payloads to the client. |
| **`removeUser(connectionId)`** | Cleans up the connection and broadcasts a `system` message ("User Left") to others. |
| **`handleEdit(id, op)`** | The central processing loop. Routes messages based on `op.type` (`update`, `chat`, `restore`). Handles the **10-minute snapshot throttle** logic using Redis `SETNX` locks. |
| **`broadcast(id, message)`** | Sends a message to all connected clients *except* the sender (Echo Suppression). |

---

## 2. Database Schema (Redis)

We use Redis as a high-performance Key-Value store and persistent cache. Here are the keys used:

| Key Pattern | Type | Content / Description |
| :--- | :--- | :--- |
| **`doc:{docId}`** | String | The current HTML/Text content of the document. |
| **`doc_owner:{docId}`** | String | The `userId` (email) of the document owner. |
| **`doc_acl:{docId}`** | Hash | Access Control List. Maps `userId` $\to$ `role` ('viewer', 'editor', 'commenter'). |
| **`doc_settings:{docId}`** | Hash | Stores settings like `link_access` ('none', 'view', 'edit'). |
| **`doc_tabs:{docId}`** | List | Ordered list of tab names (e.g., "Sheet 1", "Sheet 2"). |
| **`history:{docId}`** | List | JSON objects representing version snapshots (Timestamp + Content). |
| **`chat:{docId}`** | List | JSON objects representing chat messages. |
| **`user_docs:{userId}`** | Set | List of `docId`s that a user has access to (for Dashboard). |
| **`otp:{email}`** | String | Temporary One-Time Password for login (TTL: 5 mins). |

---

## 3. Communication Protocol (WebSocket)

The Frontend and Backend communicate using a standardized JSON format over WebSocket (`ws://`).

**Base Message Structure:**
```json
{
  "type": "string",
  "userId": "string",  // Sender's Email
  "content": "any",    // Payload (depends on type)
  ...extra_fields
}
```

### A. Real-Time Editing

| Type | Direction | Payload Example | Description |
| :--- | :--- | :--- | :--- |
| **`update`** | Bidirectional | `{"content": "<html>..."}` | Contains the full HTML content. Sent when user stops typing. |
| **`cursor`** | Bidirectional | `{"range": {"index": 5, "length": 0}, "color": "#FF0000"}` | Broadcasts cursor position and selection highlight. |
| **`typing`** | Bidirectional | `{"isTyping": true}` | Triggers the "User is typing..." indicator. |

### B. State Synchronization

| Type | Direction | Payload Example | Description |
| :--- | :--- | :--- | :--- |
| **`sync`** | Server → Client | `{"content": "..."}` | Sent immediately after connection to hydrate the editor. |
| **`access_info`** | Server → Client | `{"role": "editor"}` | Tells the client if they are read-only or editable. |
| **`user_list`** | Server → Client | `{"list": [{"userId": "a@b.com", "color": "#123"}]}` | Updates the avatar stack in the header. |

### C. Chat & Notifications

| Type | Direction | Payload Example | Description |
| :--- | :--- | :--- | :--- |
| **`chat`** | Bidirectional | `{"message": "Hi", "quote": "selected text"}` | A new chat message (optionally with quoted text). |
| **`chat_history`**| Server → Client | `{"list": [...]}` | Sends last 50 messages on join. |
| **`system`** | Server → Client | `{"message": "Bob joined", "color": "green"}` | Triggers UI toast notifications. |

### D. Version Control

| Type | Direction | Payload Example | Description |
| :--- | :--- | :--- | :--- |
| **`fetch_history`** | Client → Server | `{}` | Requests the list of saved snapshots. |
| **`history_list`** | Server → Client | `{"list": [{"timestamp": 123, "content": "..."}]}` | Returns the array of versions. |
| **`restore`** | Client → Server | `{"content": "..."}` | Overwrites current document with an old version. |

---

## 4. Security & Error Handling

### Connection Handshake
1.  **Client** attempts connection: `ws://host?docId=A&userId=B`.
2.  **Server** checks Redis ACL (`doc_acl:A`) and Link Settings (`doc_settings:A`).
    * If `userId` is not found **AND** `link_access` is 'none' → **Close Connection (Access Denied)**.
    * Else → **Upgrade Connection** and assign Role (Owner/Editor/Viewer).

### Error Messages
The server sends error frames for unauthorized actions:

```json
{
  "type": "error",
  "message": "Access Denied: You do not have permission to edit."
}
