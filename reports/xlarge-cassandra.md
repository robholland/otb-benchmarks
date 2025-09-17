# Cluster Stack: xlarge-cassandra

## Summary

### 💰 Total Estimated Monthly Cost
**$9561.94**

### 🎯 Benchmark Target
- **Target Throughput:** 10000 state transitions/second

- **Namespaces:** 6

---

## AWS Region
- **Region:** us-west-2
- **Availability Zones:** us-west-2a, us-west-2b, us-west-2c

## EKS Node Groups
| Name | Instance Type | Node Count | Cost/Node/Hour | Monthly Cost |
|------|--------------|------------|----------------|-------------|
| cluster-core | r5.xlarge | 3 | $0.2520 | $544.32 |
| cluster-worker | c5.xlarge | 4 | $0.1700 | $489.60 |
| cluster-temporal | c5.4xlarge | 8 | $0.6800 | $3916.80 |

- **Total EKS Monthly Cost:** $4950.72

## Persistence
### Cassandra
| Instance Type | Node Count | CPU Request | Memory Request | Cost/Node/Hour | Storage/Node | Storage Cost/Node/Month | Total Monthly Cost |
|--------------|------------|-------------|----------------|----------------|--------------|-------------------------|--------------------|
| c5.2xlarge | 15 | 8 | 16Gi | $0.3400 | 513.0 GB | $41.04 | $4287.60 |

**Storage Details:**
- **Per Node:** 1 GB commit log + 512 GB data storage (gp3)
- **Total Cluster:** 7695 GB across 15 nodes

### OpenSearch
| Instance Type | Instance Count | Storage/Instance | Total Storage | Instance Cost/Month | Storage Cost/Month | Total Cost/Month |
|---------------|----------------|------------------|---------------|---------------------|--------------------|--------------------|
| m5.large.search | 3 | 100 GB | 300 GB | $306.72 | $16.90 | $323.62 |

- **Total Persistence Monthly Cost:** $4611.22

## Temporal Services

| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory |
|-----------|------|-------------------|----------------------|-----------|-------------|
| Frontend  | 6    | 2               | 256Mi                | 12       | 1.50Gi     |
| History   | 12    | 4               | 4.00Gi                | 48       | 48.00Gi     |
| Matching  | 6    | 2               | 256Mi                | 12       | 1.50Gi     |
| Worker    | 2    | 0.25               | 128Mi                | 0.5       | 256Mi     |

- **History Shards:** 2048

## Benchmark Workers

| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |
|------|---------------|------------------|------------------|------------------|
| 3 | 0.25 | 50Mi | 100 | 150 |

