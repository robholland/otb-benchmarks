import * as pulumi from "@pulumi/pulumi";

export interface AWSConfig {
  Region: string;
  VpcId: string;
  Role: string;
  RdsSubnetGroupName: string;
  PrivateSubnetIds: string[];
  AvailabilityZones: string[];
  PrometheusEndpoint: string;
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
  CommitLogStorage: string;
  DataStorage: string;
  CPU: {
    Limit: number;
  };
  Memory: {
    Limit: string;
  };
}

export interface OpenSearchConfig {
  MasterInstanceType: string;
  MasterInstanceCount: number;
  DataInstanceType: string;
  DataInstanceCount: number;
  EngineVersion: string;
}

export interface DynamicConfig {
  FrontendRPS?: number;
  FrontendNamespaceRPS?: number;
  MatchingRPS?: number;
  HistoryRPS?: number;
}

export interface TemporalConfig {
  Frontend: {
    Pods: number;
    CPU: {
      Request: number;
    };
    Memory: {
      Request: string;
    };
  };
  History: {
    Pods: number;
    Shards: number;
    CPU: {
      Request: number;
    };
    Memory: {
      Request: string;
    };
  };
  Matching: {
    Pods: number;
    CPU: {
      Request: number;
    };
    Memory: {
      Request: string;
    };
  };
  Worker: {
    Pods: number;
    CPU: {
      Request: number;
    };
    Memory: {
      Request: string;
    };
  };
  DynamicConfig?: DynamicConfig;
}

export interface Cluster {
  name: any;
  kubeconfig: any;
  provider: any;
  securityGroup: any;
  instanceRoles: any;
}

export interface BenchmarkConfig {
  Namespaces: number;
  Target: number;
  ConcurrentWorkflows: number;
  Workers: {
    Pods: number;
    WorkflowPollers: number;
    ActivityPollers: number;
    CPU: {
      Request: number;
    };
    Memory: {
      Request: string;
    };
  };
  SoakTest: {
    Pods: number;
    CPU: {
      Request: number;
    };
    Memory: {
      Request: string;
    };
  };
}

export interface Stage<T = any> {
  values: pulumi.Output<T>;
  dependencies: pulumi.Resource[];
}
