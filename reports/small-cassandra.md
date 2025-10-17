# Cluster Stack: small-cassandra

## Summary

### 🎯 Benchmark Target
- **Target Throughput:** 500 state transitions/second (sts)
- **Namespaces:** 3

### 📊 Provisioning Ratios
- **CPU Cores (Frontend + History + Matching):** 9 cores
- **State Transitions per Core:** 56 sts/core
- **Frontend:** 3 cores (167 sts/core)
- **History:** 3 cores (167 sts/core)
- **Matching:** 3 cores (167 sts/core)
- **Cassandra Database:** 24 cores (21 sts/core)

---

## AWS Region
- **Region:** us-west-2
- **Availability Zones:** us-west-2a, us-west-2b, us-west-2c

## EKS Node Groups
| Name | Instance Type | Node Count | Purpose |
|------|--------------|------------|---------|
| cluster-core | r5.xlarge | 3 | core |
| cluster-temporal | c5.2xlarge | 3 | temporal |
| cluster-worker | c5.2xlarge | 3 | worker |


## Persistence
### Cassandra
| Instance Type | Node Count | CPU Request | Memory Request | Storage/Node |
|--------------|------------|-------------|----------------|--------------|
| c5.2xlarge | 3 | 8 | 16Gi | 128.3 GB |

**Storage Details:**
- **Per Node:** 0.25 GB commit log + 128 GB data storage (gp3)
- **Total Cluster:** 384.75 GB across 3 nodes

### OpenSearch
| Node Type | Instance Type | Instance Count |
|-----------|---------------|----------------|
| Master | r6gd.large.search | 3 |
| Data | r6gd.large.search | 3 |
| **Total** | - | **6** |

- **Engine Version:** OpenSearch_2.11
- **Storage:** NVMe (included with instance)

## Temporal Services

| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory | STS/Core |
|-----------|------|-------------------|----------------------|-----------|--------------|----------|
| Frontend  | 3    | 1               | 256Mi                | 3       | 768Mi     | 167    |
| History   | 3    | 1               | 4.00Gi                | 3       | 12.00Gi     | 167    |
| Matching  | 3    | 1               | 256Mi                | 3       | 768Mi     | 167    |
| Worker    | 3    | 0.25               | 128Mi                | 0.75       | 384Mi     | 667    |

- **History Shards:** 512

## Benchmark Workers

| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |
|------|---------------|------------------|------------------|------------------|
| 3 | 1 | 50Mi | 30 | 50 |

