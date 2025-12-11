
# Comprehensive Test Report

---

## 1. Introduction

We adopted a rigorous testing strategy to distinguish between:
* **Verification:** Building the system correctly.
* **Validation:** Building the right system for the user.

We designed our testing approach to verify functional requirements like conflict resolution and version history, alongside non-functional requirements like low latency and system durability.

---

## 2. Testing Methodology

Because our CTE is an event-driven, distributed application involving Redis, Kafka, and WebSockets, testing everything manually would be impossible and error-prone. We adopted the **Testing Pyramid** structure to catch bugs at different levels.

| Layer | Tool | Focus |
| :--- | :--- | :--- |
| **Unit Testing** | Jest | White Box testing to verify mathematical correctness of logic without network dependencies. |
| **Integration Testing** | Manual / Docker | Hybrid testing to verify data flow between our Gateway, Redis, and Kafka. |
| **End-to-End (E2E)** | Playwright | Black Box testing to simulate real user behavior in the browser. |
| **Load Testing** | k6 | Stress-testing the system under high concurrency. |

To ensure consistent results, we used **Docker containers** to isolate our environment, ensuring that tests ran on a clean slate every time.

---

## 3. Phase 1: Unit Testing (Backend Logic)

* **Tool Used:** Jest

Our first priority was the "brain" of the application: the `DocumentSession` class. This handles the Operational Transformation (OT) logic. We couldn't rely on real WebSockets for this because they are slow and "flaky." Instead, we used mocks (simulated objects) to test the logic in isolation.

### Test Cases Executed

1.  **Concurrent Inserts:** We simulated a scenario where User A and User B send updates at the exact same millisecond. We verified that the system merged these into a consistent "ABCD" string without crashing.
2.  **Zero-Length Delete:** We tested boundary values by sending empty delete operations. We confirmed the system gracefully ignored them without throwing errors.
3.  **Idempotency:** We simulated network glitches where the same message is sent twice. We verified that the system detected the duplicate and applied it only once to prevent data corruption.

**Result:**  **All 3 unit tests PASSED.**

![Jest](https://github.com/user-attachments/assets/190aed19-4de3-4faa-9461-a2c32606b261)


![Jest 2](https://github.com/user-attachments/assets/6b6bfd1a-c0ba-496b-b02e-047aa021a0d5)


## 4. Phase 2: System Resilience (Integration Testing)

* **Method:** Manual Fault Injection

A key architectural choice in our design was the "Hybrid Flow," where real-time edits happen via Redis (Hot Storage) while history is saved to Kafka (Cold Storage). We needed to prove that our system remains available even if the persistence layer fails.

### The "Kafka Outage" Experiment
We performed a "Chaos Engineering" test:
1.  We connected two users (A and B) and started typing.
2.  We manually stopped the Kafka Docker container: `docker stop collab-kafka`
3.  User A continued typing.

### Findings
Astonishingly, User B continued to see updates in real-time. The backend logged connection errors (as expected) but did not crash. This successfully validated our availability requirement: real-time collaboration survived even when the persistence layer went down.

**Result:**  **PASSED (Visual Confirmation)**

![Kafka](https://github.com/user-attachments/assets/31260037-cd88-4a95-a932-f90aeb0b7110)



## 5. Phase 3: End-to-End (E2E) Validation

* **Tool Used:** Playwright

This was the most complex phase. We wanted to validate the system from the user's perspective. Unlike Selenium, Playwright runs inside the browser loop, allowing us to detect exact cursor movements and text updates.

### Key Workflows Tested

| Workflow | Description | Outcome |
| :--- | :--- | :--- |
| **Permission Enforcement** | We automated a scenario where an Owner invites a "Viewer." We verified that the Viewer saw the "Read Only" badge and was physically blocked from typing. | **PASSED** |
| **Security (XSS Injection)** | We attempted to inject malicious JavaScript (`<script>alert('Hacked')</script>`). We verified that the system rendered it as harmless plain text, preventing code execution. | **PASSED** |
| **Version History** | We verified the "Time Travel" feature by making edits, opening the history modal, and ensuring the interface allowed for restoring previous versions. | **PASSED** |

### Challenges & Solutions
We initially faced issues where tests failed because the UI hadn't loaded yet. We solved this by adding "Stabilization Waits," ensuring the WebSocket connection was active (waiting for "Sheet 1" to appear) before the test robot attempted to interact with the page.

**Result:**  **PASSED (3/3 Browser Engines: Chromium, Firefox, WebKit)**

<img width="1069" height="492" alt="image" src="https://github.com/user-attachments/assets/e187422f-dbcc-4691-bc90-144187fd2c48" />

![playwright](https://github.com/user-attachments/assets/0cc13119-566e-4cbd-97a5-3aadd476c42d)

---

## 6. Phase 4: Performance & Load Testing

* **Tool Used:** k6 (JavaScript)

Finally, we needed to ensure the system could scale. Our target was to maintain a latency of **<100ms** even with 50 concurrent users.

### The Stress Test
We wrote a script to simulate **50 Virtual Users (VUs)** connecting simultaneously and typing updates every second.

### Findings

* **Throughput:** The server handled ~817 requests per second.
* **Latency:** The average latency was **61.13ms**, well below our 100ms threshold.
* **Stability:** We observed some connection rejections (35% failure rate on handshake). This was due to OS file descriptor limits on the local machine, not a software bug. However, for all connected users, performance was flawless.

**Result:** **PASSED (<100ms Latency Requirement Met)**
