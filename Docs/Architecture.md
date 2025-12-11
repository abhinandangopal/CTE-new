#  System Architecture

This document provides information into the architecture of the **Collaborative Text Editor (CTE)**. The system is designed as a **Distributed, Event-Driven Microservice** architecture that prioritizes low-latency synchronization while ensuring eventual data durability.

## 1\. High-Level Architecture Diagram
```mermaid
graph TD
    ClientA["Client A (React)"] -- WebSocket --> LB["Load Balancer"]
    ClientB["Client B (React)"] -- WebSocket --> LB

    subgraph Backend_Infrastructure
        LB -- WSS --> NodeService["Node.js Backend"]
        NodeService -- "Pub/Sub & Cache" --> Redis[("Redis - Hot Storage")]
        NodeService -- "Event Stream" --> Kafka[("Kafka - Cold Storage")]
    end

    subgraph Persistence_Layer
        Kafka -- Consumer --> S3["Snapshot Storage"]
        Kafka -- Consumer --> DB["Metadata DB"]
    end

```
   

### Component Breakdown

| Component | Technology | Responsibility |
| :--- | :--- | :--- |
| **Frontend Client** | React + Vite | Renders the editor, captures user events (keystrokes, cursors), and manages local OT state using `Quill.js`. |
| **API Gateway** | Node.js + Express | Handles HTTP requests for Authentication (OTP), Document Management (Create/List), and Permissions (RBAC). |
| **Real-Time Gateway** | Node.js + `ws` | Maintains persistent WebSocket connections. Routes messages to the appropriate `DocumentSession` in memory. |
| **Hot Storage** | **Redis** | Acts as the "source of truth" for the live session. Stores the current document state, active user list, and chat history for \<5ms access. |
| **Cold Storage** | **Apache Kafka** | Acts as the durable event log. All edits are pushed here asynchronously to ensure data is never lost, even if the cache fails. |

-----

## 2\. Core Logic: The "Hybrid Data Flow"

To meet the non-functional requirement of **\<100ms latency**, we separated the data flow into two distinct paths.

### Real-Time Sync

  * **Goal:** Immediate user feedback.
  * **Flow:** `Client -> WebSocket -> Server Memory -> Redis -> Broadcast`.
  * **Mechanism:** When a user types, the delta is sent to the Node.js server. The server immediately updates the in-memory session and Redis cache, then broadcasts the change to all other connected clients.
  * **Latency:** \~50-60ms (Verified via k6 Load Testing).

### Persistence & History

  * **Goal:** Durability and Version Control.
  * **Flow:** `Server -> Kafka Topic -> Persistence Worker`.
  * **Mechanism:** In parallel with the broadcast, the server pushes the edit operation to a Kafka topic (`document-edits`).
  * **Throttling:** To prevent database bloat, a **10-minute throttle lock** is implemented in Redis. A full snapshot of the document is only saved to the permanent history list if 10 minutes have passed since the last save.

-----

## 3\. Conflict Resolution Strategy

Collaborative editing requires handling race conditions where two users edit the same word simultaneously. We utilize a **Hybrid Operational Transformation (OT)** strategy.

### A. Client-Side OT (Quill Deltas)

The frontend uses **Quill Deltas** to represent changes mathematically rather than as raw strings.

  * **Example:** Instead of sending "The document text", a user sends `{ retain: 5, insert: "new" }`.
  * **Benefit:** If User A types at index 0 and User B types at index 100, the operations do not conflict. Quill merges them automatically.

### B. Server-Side Resolution (Last-Write-Wins)

For colliding edits (e.g., two users modifying the exact same character at the exact same millisecond), the backend enforces **Last-Write-Wins (LWW)** granularity at the operation level.

  * The server processes messages serially per document room.
  * The state stored in Redis serves as the "Official Truth."
  * If a client falls out of sync, the `sync` message type forces a hard-reset of the client's state to match the server.

-----

## 4\. Authorization (Permissions)

Permissions are checked at **two gateways**:

1.  **HTTP API Level:** Middleware checks Redis ACLs (`doc_acl:{id}`) before allowing actions like "Rename Document" or "Kick User."
2.  **WebSocket Level:** On connection upgrade, the server validates the user's role.
      * **Viewers:** Socket rejects `update` messages.
      * **Commenters:** Socket accepts `chat` messages but rejects `update` (text) messages.
      * **Editors/Owners:** Full access.

-----

## 5\. Scalability Design

The architecture allows for horizontal scaling (adding more servers) without breaking the application.

  * **Stateless API:** The Express API is stateless; any request can go to any server.
  * **Stateful WebSockets:** The `DocumentSession` class holds state in memory for performance, but **Redis Pub/Sub** is used as the backbone.
  * **Scaling Strategy:** If we run multiple backend instances, they subscribe to Redis channels. If User A is connected to Server 1 and User B to Server 2, Redis bridges the messages between them, allowing the system to scale to thousands of concurrent users.
