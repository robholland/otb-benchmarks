# Cluster Stack: xxlarge-cassandra

## Summary

### 💰 Total Estimated Monthly Cost
**$19227.94**

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
| cluster-worker | c5.xlarge | 6 | $0.1700 | $734.40 |
| cluster-core | r5.xlarge | 3 | $0.2520 | $544.32 |
| cluster-temporal | c5.4xlarge | 16 | $0.6800 | $7833.60 |

- **Total EKS Monthly Cost:** $9112.32

## Persistence
### Cassandra
| Instance Type | Node Count | CPU Request | Memory Request | Cost/Node/Hour | Monthly Cost |
|--------------|------------|-------------|----------------|----------------|-------------|
| c5.2xlarge | 40 | 8 | 16Gi | $0.3400 | $9792.00 |
### OpenSearch
| Instance Type | Instance Count | Storage/Instance | Total Storage | Instance Cost/Month | Storage Cost/Month | Total Cost/Month |
|---------------|----------------|------------------|---------------|---------------------|--------------------|--------------------|
| m5.large.search | 3 | 100 GB | 300 GB | $306.72 | $16.90 | $323.62 |

- **Total Persistence Monthly Cost:** $10115.62

## Temporal Services

| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory |
|-----------|------|-------------------|----------------------|-----------|-------------|
| Frontend  | 15    | 2               | 256Mi                | 30       | 3.75Gi     |
| History   | 12    | 8               | 4.00Gi                | 96       | 48.00Gi     |
| Matching  | 9    | 4               | 256Mi                | 36       | 2.25Gi     |
| Worker    | 2    | 0.25               | 128Mi                | 0.5       | 256Mi     |

- **History Shards:** 4096

## Benchmark Workers

| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |
|------|---------------|------------------|------------------|------------------|
| 3 | 0.5 | 50Mi | 100 | 150 |

