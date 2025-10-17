# Cluster Stack: medium-mysql

## Summary

### 🎯 Benchmark Target
- **Target Throughput:** 1500 state transitions/second (sts)
- **Namespaces:** 3

### 📊 Provisioning Ratios
- **CPU Cores (Frontend + History + Matching):** 12 cores
- **State Transitions per Core:** 125 sts/core
- **Frontend:** 3 cores (500 sts/core)
- **History:** 6 cores (250 sts/core)
- **Matching:** 3 cores (500 sts/core)
- **RDS Database:** 8 cores (188 sts/core)

---

## AWS Region
- **Region:** us-west-2
- **Availability Zones:** us-west-2a, us-west-2b, us-west-2c

## EKS Node Groups
| Name | Instance Type | Node Count | Purpose |
|------|--------------|------------|---------|
| cluster-core | m5.2xlarge | 3 | core |
| cluster-temporal | c5.2xlarge | 3 | temporal |
| cluster-worker | c5.xlarge | 3 | worker |


## Persistence
### RDS
- **Engine:** mysql 8.4.5
- **Instance Type:** db.r5.2xlarge (8 CPU cores)
- **Multi-AZ:** Yes
- **Storage:** 1024 GB (gp3)

## Temporal Services

| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory | STS/Core |
|-----------|------|-------------------|----------------------|-----------|--------------|----------|
| Frontend  | 3    | 1               | 256Mi                | 3       | 768Mi     | 500    |
| History   | 6    | 1               | 4.00Gi                | 6       | 24.00Gi     | 250    |
| Matching  | 3    | 1               | 256Mi                | 3       | 768Mi     | 500    |
| Worker    | 3    | 0.25               | 128Mi                | 0.75       | 384Mi     | 2000    |

- **History Shards:** 512

## Benchmark Workers

| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |
|------|---------------|------------------|------------------|------------------|
| 3 | 0.25 | 50Mi | 100 | 150 |

