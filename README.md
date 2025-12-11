#  Real-Time Distributed Collaborative Text Editor (CTE)

> A Google Docs-style collaborative editor built with a **Distributed Microservices Architecture**. It features real-time synchronization, version control, role-based access, and chat, capable of handling 50+ concurrent users with <100ms latency.

---

## Documentation Index

| Document | Description |
| :--- | :--- |
| **[Project Structure](./Docs/Structure)** | Explanation of folders, files, and code organization. |
| **[System Architecture](./Docs/Architecture.md)** | High-level diagrams, Hybrid Data Flow, and Scalability design. |
| **[Low-Level Design (LLD)](./Docs/LLD.md)** | Class structure (`DocumentSession`), Database Schema, and WebSocket Protocol. |
| **[Test Report](./Docs/Testing.md)** | Comprehensive results from Unit, Integration, E2E, and Load testing. |

---

##  Key Features

###  Real-Time Collaboration
* **Operational Transformation (OT):** Custom logic ensures document consistency when multiple users type simultaneously.
* **Live Cursors:** See exactly where other users are typing in real-time.
* **Presence Indicators:** Visual avatars showing active users in the document.

###  Security & Access Control
* **Granular Permissions:** Invite users as **Viewer**, **Commenter**, or **Editor**.
* **Link Sharing:** Toggle between "Restricted" and "Public Link" access.
* **Secure Rooms:** WebSocket connections are authenticated and isolated per document.

###  Data & Persistence
* **Hybrid Storage:** Uses **Redis** for ultra-fast hot storage (live sync) and **Kafka** for durable event logging.
* **Version History:** Automatic snapshots every 10 minutes with instant restore capability.
* **Export:** Download documents as `.docx` or `.pdf`.

###  Communication
* **Integrated Chat:** Discuss changes in a sidebar without leaving the editor.
* **Smart Quoting:** Highlight text to reference it directly in the chat.

---

##  Tech Stack

| Component | Technology | Role |
| :--- | :--- | :--- |
| **Frontend** | React + Vite + TypeScript | Responsive UI & Editor Logic |
| **Editor Core** | ReactQuill (Quill.js) | Rich Text handling & Delta events |
| **Backend** | Node.js + Express | REST API & WebSocket Gateway |
| **Real-Time** | Native WebSockets (ws) | Bi-directional communication |
| **Hot Storage** | Redis (Pub/Sub) | State management & User presence |
| **Event Bus** | Apache Kafka + Zookeeper | Durable event logging & Async processing |
| **DevOps** | Docker & Docker Compose | Containerization & Orchestration |

---

##  Architecture

The system follows a **Event-Driven Microservices** pattern.
* **Read the full [System Architecture Document](./Docs/Architecture.md)** for deep dives into the OT Algorithm and Hybrid Data Flow.

---

##  Testing & Validation

We employed a "Testing Pyramid" strategy covering Unit, Integration, E2E, and Load testing.
* **Performance:** Verified <61ms average latency under 50-user load.
* **Resilience:** System proved resilient to Kafka outages during manual fault injection.
* **Read the full [Test Report](./Docs/Testing.md)**.
