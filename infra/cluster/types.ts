export interface AWSConfig {
  Region: string;
  VpcId: string;
  Role: string;
  RdsSubnetGroupName: string;
  PrivateSubnetIds: string[];
  AvailabilityZones: string[];
}

export interface ClusterConfig {
  EKS?: EKSClusterConfig;
}

export interface EKSClusterConfig {
  NodeType: string;
  NodeCount: number;
  TemporalNodeType: string;
  TemporalNodeCount: number;
  WorkerNodeType: string;
  WorkerNodeCount: number;
}

export interface PersistenceConfig {
  RDS?: RDSPersistenceConfig;
  Cassandra?: CassandraPersistenceConfig;
  Visibility?: {
    OpenSearch?: OpenSearchConfig;
  };
}

export interface RDSPersistenceConfig {
  Engine: string;
  EngineVersion: string;
  InstanceType: string;
  IOPS?: number;
}

export interface CassandraPersistenceConfig {
  NodeType: string;
  NodeCount: number;
  ReplicaCount: number;
}

export interface OpenSearchConfig {
  InstanceType: string;
  EngineVersion: string;
}

export interface TemporalConfig {
  Frontend: {
    Pods: number;
    CPU: {
      Request: string | number;
    };
    Memory: {
      Request: string;
    };
  };
  History: {
    Pods: number;
    Shards: number;
    CPU: {
      Request: string | number;
    };
    Memory: {
      Request: string;
    };
  };
  Matching: {
    Pods: number;
    CPU: {
      Request: string | number;
    };
    Memory: {
      Request: string;
    };
  };
  Worker: {
    Pods: number;
    CPU: {
      Request: string | number;
    };
    Memory: {
      Request: string;
    };
  };
}

export interface Cluster {
  name: any;
  kubeconfig: any;
  provider: any;
  securityGroup: any;
  instanceRoles: any;
}

export interface BenchmarkConfig {
  Workers: {
    Pods: number;
    WorkflowPollers: number;
    ActivityPollers: number;
    CPU: {
      Request: string | number;
    };
    Memory: {
      Request: string;
    };
  };
  SoakTest: {
    Pods: number;
    ConcurrentWorkflows: number;
    Target: number;
    CPU: {
      Request: string | number;
    };
    Memory: {
      Request: string;
    };
  };
}
