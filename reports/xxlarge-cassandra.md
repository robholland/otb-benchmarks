# Cluster Stack: xxlarge-cassandra

## Summary

### 💰 Total Estimated Monthly Cost
**$36561.22**

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
| cluster-core | r5.xlarge | 3 | $0.2520 | $544.32 |
| cluster-worker | c5.xlarge | 8 | $0.1700 | $979.20 |
| cluster-temporal | c5.4xlarge | 16 | $0.6800 | $7833.60 |

- **Total EKS Monthly Cost:** $9357.12

## Persistence
### Cassandra
| Instance Type | Node Count | CPU Request | Memory Request | Cost/Node/Hour | Storage/Node | Storage Cost/Node/Month | Total Monthly Cost |
|--------------|------------|-------------|----------------|----------------|--------------|-------------------------|--------------------|
| c5.2xlarge | 72 | 8 | 16Gi | $0.3400 | 512.5 GB | $41.00 | $20577.60 |

**Storage Details:**
- **Per Node:** 0.5 GB commit log + 512 GB data storage (gp3)
- **Total Cluster:** 36900 GB across 72 nodes

### OpenSearch
| Node Type | Instance Type | Instance Count | Storage/Instance | Total Storage | Instance Cost/Month | Storage Cost/Month | Total Cost/Month |
|-----------|---------------|----------------|------------------|---------------|---------------------|--------------------|--------------------|
| Master | r6gd.2xlarge.search | 3 | 100 GB | 1200 GB | $1652.40 | - | $1652.40 |
| Data | r6gd.2xlarge.search | 9 | 100 GB | - | $4957.20 | $16.90 | $4974.10 |
| **Total** | - | **12** | **100 GB** | **1200 GB** | **$6609.60** | **$16.90** | **$6626.50** |

- **Total Persistence Monthly Cost:** $27204.10

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

