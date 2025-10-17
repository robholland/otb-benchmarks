# Cluster Stack: xxlarge-cassandra

## Summary

### 🎯 Benchmark Target
- **Target Throughput:** 30000 state transitions/second (sts)
- **Namespaces:** 12

### 📊 Provisioning Ratios
- **CPU Cores (Frontend + History + Matching):** 162 cores
- **State Transitions per Core:** 185 sts/core
- **Frontend:** 30 cores (1000 sts/core)
- **History:** 96 cores (313 sts/core)
- **Matching:** 36 cores (833 sts/core)
- **Cassandra Database:** 576 cores (52 sts/core)

---

## AWS Region
- **Region:** us-west-2
- **Availability Zones:** us-west-2a, us-west-2b, us-west-2c

## EKS Node Groups
| Name | Instance Type | Node Count | Purpose |
|------|--------------|------------|---------|
| cluster-worker | c5.xlarge | 8 | worker |
| cluster-temporal | c5.4xlarge | 16 | temporal |
| cluster-core | r5.xlarge | 3 | core |


## Persistence
### Cassandra
| Instance Type | Node Count | CPU Request | Memory Request | Storage/Node |
|--------------|------------|-------------|----------------|--------------|
| c5.2xlarge | 72 | 8 (8 cores available) | 16Gi | 512.5 GB |

**Storage Details:**
- **Per Node:** 0.5 GB commit log + 512 GB data storage (gp3)
- **Total Cluster:** 36900 GB across 72 nodes

### OpenSearch
| Node Type | Instance Type | Instance Count |
|-----------|---------------|----------------|
| Master | r6gd.2xlarge.search | 3 |
| Data | r6gd.2xlarge.search | 9 |
| **Total** | - | **12** |

- **Engine Version:** OpenSearch_2.11
- **Storage:** NVMe (included with instance)

## Temporal Services

| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory |
|-----------|------|-------------------|----------------------|-----------|-------------|
| Frontend  | 15    | 2               | 256Mi                | 30       | 3.75Gi     |
| History   | 12    | 8               | 8.00Gi                | 96       | 96.00Gi     |
| Matching  | 9    | 4               | 256Mi                | 36       | 2.25Gi     |
| Worker    | 2    | 0.25               | 128Mi                | 0.5       | 256Mi     |

- **History Shards:** 4096

## Benchmark Workers

| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |
|------|---------------|------------------|------------------|------------------|
| 3 | 0.5 | 50Mi | 100 | 150 |

