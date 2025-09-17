# Cluster Stack: xxlarge-cassandra

## Summary

### 💰 Total Estimated Monthly Cost
**$22752.74**

### 🎯 Benchmark Target
- **Target Throughput:** 30000 state transitions/second

- **Namespaces:** 12

---

## AWS Region
- **Region:** us-west-2
- **Availability Zones:** us-west-2a, us-west-2b, us-west-2c

## EKS Node Groups
| Name | Instance Type | Node Count | Cost/Node/Hour | Monthly Cost |
|------|--------------|------------|----------------|-------------|
| cluster-worker | c5.xlarge | 8 | $0.1700 | $979.20 |
| cluster-core | r5.xlarge | 3 | $0.2520 | $544.32 |
| cluster-temporal | c5.4xlarge | 16 | $0.6800 | $7833.60 |

- **Total EKS Monthly Cost:** $9357.12

## Persistence
### Cassandra
| Instance Type | Node Count | CPU Request | Memory Request | Cost/Node/Hour | Storage/Node | Storage Cost/Node/Month | Total Monthly Cost |
|--------------|------------|-------------|----------------|----------------|--------------|-------------------------|--------------------|
| c5.2xlarge | 40 | 8 | 16Gi | $0.3400 | 1025.0 GB | $82.00 | $13072.00 |

**Storage Details:**
- **Per Node:** 1 GB commit log + 1024 GB data storage (gp3)
- **Total Cluster:** 41000 GB across 40 nodes

### OpenSearch
| Instance Type | Instance Count | Storage/Instance | Total Storage | Instance Cost/Month | Storage Cost/Month | Total Cost/Month |
|---------------|----------------|------------------|---------------|---------------------|--------------------|--------------------|
| m5.large.search | 3 | 100 GB | 300 GB | $306.72 | $16.90 | $323.62 |

- **Total Persistence Monthly Cost:** $13395.62

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

