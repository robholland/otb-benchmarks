import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

const azCount = 3;

const vpc = new awsx.ec2.Vpc("temporal-benchmark", {
    numberOfAvailabilityZones: azCount
});

const rdsSubnetGroup = new aws.rds.SubnetGroup("temporal-benchmark-rds", {
    subnetIds: vpc.privateSubnetIds
});

export const VpcId = vpc.vpcId;
export const AvailabilityZones = vpc.privateSubnetIds.apply(ids => {
    return pulumi.all(ids.map(id => aws.ec2.getSubnet({id}))).apply(subnets => {
        return subnets.map(s => s.availabilityZone);
    });
});
export const PrivateSubnetIds = vpc.privateSubnetIds;
export const PublicSubnetIds = vpc.publicSubnetIds;
export const RdsSubnetGroupName = rdsSubnetGroup.name;
export const Role = "BenchmarkClusterAdmin";