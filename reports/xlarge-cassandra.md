# Cluster Stack: xlarge-cassandra

## Summary

### 🎯 Benchmark Target
- **Target Throughput:** 10000 state transitions/second (sts)
- **Namespaces:** 6

### 📊 Provisioning Ratios
- **CPU Cores (Frontend + History + Matching):** 72 cores
- **State Transitions per Core:** 139 sts/core
- **Frontend:** 12 cores (833 sts/core)
- **History:** 48 cores (208 sts/core)
- **Matching:** 12 cores (833 sts/core)

---

## AWS Region
- **Region:** us-west-2
- **Availability Zones:** us-west-2a, us-west-2b, us-west-2c

## EKS Node Groups
| Name | Instance Type | Node Count | Purpose |
|------|--------------|------------|---------|
| cluster-worker | c5.xlarge | 4 | worker |
| cluster-core | r5.xlarge | 3 | core |
| cluster-temporal | c5.4xlarge | 8 | temporal |


## Persistence
### Cassandra
| Instance Type | Node Count | CPU Request | Memory Request | Storage/Node |
|--------------|------------|-------------|----------------|--------------|
| c5.2xlarge | 15 | - | - | 512.5 GB |

**Storage Details:**
- **Per Node:** 0.5 GB commit log + 512 GB data storage (gp3)
- **Total Cluster:** 7687.5 GB across 15 nodes

### OpenSearch
| Node Type | Instance Type | Instance Count |
|-----------|---------------|----------------|
| Master | m5.large.search | 3 |
| Data | r6gd.2xlarge.search | 3 |
| **Total** | - | **6** |

- **Engine Version:** OpenSearch_2.11
- **Storage:** NVMe (included with instance)

## Temporal Services

| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory | STS/Core |
|-----------|------|-------------------|----------------------|-----------|--------------|----------|
| Frontend  | 6    | 2               | 256Mi                | 12       | 1.50Gi     | 833    |
| History   | 12    | 4               | 4.00Gi                | 48       | 48.00Gi     | 208    |
| Matching  | 6    | 2               | 256Mi                | 12       | 1.50Gi     | 833    |
| Worker    | 2    | 0.25               | 128Mi                | 0.5       | 256Mi     | 20000    |

- **History Shards:** 2048

## Benchmark Workers

| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |
|------|---------------|------------------|------------------|------------------|
| 3 | 0.25 | 50Mi | 100 | 150 |

