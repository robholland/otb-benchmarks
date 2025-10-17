# Cluster Stack: large-mysql

## Summary

### 🎯 Benchmark Target
- **Target Throughput:** 5000 state transitions/second (sts)
- **Namespaces:** 3

### 📊 Provisioning Ratios
- **CPU Cores (Frontend + History + Matching):** 42 cores
- **State Transitions per Core:** 119 sts/core
- **Frontend:** 12 cores (417 sts/core)
- **History:** 24 cores (208 sts/core)
- **Matching:** 6 cores (833 sts/core)
- **RDS Database:** 32 cores (156 sts/core)

---

## AWS Region
- **Region:** us-west-2
- **Availability Zones:** us-west-2a, us-west-2b, us-west-2c

## EKS Node Groups
| Name | Instance Type | Node Count | Purpose |
|------|--------------|------------|---------|
| cluster-worker | c5.xlarge | 3 | worker |
| cluster-core | r5.xlarge | 3 | core |
| cluster-temporal | c5.4xlarge | 4 | temporal |


## Persistence
### RDS
- **Engine:** mysql 8.4.5
- **Instance Type:** db.r5.8xlarge (32 CPU cores)
- **Multi-AZ:** Yes
- **Storage:** 1024 GB (gp3)

## Temporal Services

| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory | STS/Core |
|-----------|------|-------------------|----------------------|-----------|--------------|----------|
| Frontend  | 6    | 2               | 256Mi                | 12       | 1.50Gi     | 417    |
| History   | 12    | 2               | 4.00Gi                | 24       | 48.00Gi     | 208    |
| Matching  | 6    | 1               | 256Mi                | 6       | 1.50Gi     | 833    |
| Worker    | 2    | 0.25               | 128Mi                | 0.5       | 256Mi     | 10000    |

- **History Shards:** 1024

## Benchmark Workers

| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |
|------|---------------|------------------|------------------|------------------|
| 3 | 1 | 50Mi | 100 | 150 |

