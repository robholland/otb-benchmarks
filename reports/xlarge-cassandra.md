# Cluster Stack: xlarge-cassandra

## Summary

### 💰 Total Estimated Monthly Cost
**$8941.64**

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
| cluster-temporal | c5.4xlarge | 8 | $0.6800 | $3916.80 |
| cluster-worker | c5.xlarge | 4 | $0.1700 | $489.60 |
| cluster-core | r5.xlarge | 3 | $0.2520 | $544.32 |

- **Total EKS Monthly Cost:** $4950.72

## Persistence
### Cassandra
| Instance Type | Node Count | CPU Request | Memory Request | Cost/Node/Hour | Monthly Cost |
|--------------|------------|-------------|----------------|----------------|-------------|
| c5.2xlarge | 15 | 8 | 16Gi | $0.3400 | $3672.00 |
### OpenSearch
| Instance Type | Instance Count | Storage/Instance | Total Storage | Instance Cost/Month | Storage Cost/Month | Total Cost/Month |
|---------------|----------------|------------------|---------------|---------------------|--------------------|--------------------|
| m5.large.search | 3 | 100 GB | 300 GB | $306.72 | $12.20 | $318.92 |

- **Total Persistence Monthly Cost:** $3990.92

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

