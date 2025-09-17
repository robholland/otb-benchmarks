#!/usr/bin/env ts-node

import { LocalAWSPricingService } from './pricing-data';

async function testPricingData() {
    console.log('Testing AWS Pricing Data Download...\n');
    
    const testRegion = 'us-west-2';
    const pricingService = new LocalAWSPricingService(testRegion);
    
    try {
        // Force refresh the pricing data
        console.log('Refreshing pricing data...');
        await pricingService.refreshPricingData();
        
        console.log('\n=== Testing EC2 Pricing ===');
        const ec2Price = await pricingService.getEC2Pricing('c5.xlarge', testRegion);
        console.log(`c5.xlarge in ${testRegion}: $${ec2Price}/hour`);
        
        console.log('\n=== Testing RDS Pricing ===');
        const rdsPrice = await pricingService.getRDSPricing('db.t3.medium', 'postgres', testRegion);
        console.log(`db.t3.medium postgres in ${testRegion}: $${rdsPrice}/hour`);
        
        console.log('\n=== Testing OpenSearch Pricing ===');
        try {
            const openSearchPrice = await pricingService.getOpenSearchPricing('m5.large.search', testRegion);
            console.log(`m5.large.search in ${testRegion}: $${openSearchPrice}/hour`);
        } catch (error) {
            console.log(`OpenSearch pricing error: ${error}`);
        }
        
        try {
            const openSearchStoragePrice = await pricingService.getOpenSearchStoragePricing(testRegion);
            console.log(`OpenSearch storage in ${testRegion}: $${openSearchStoragePrice}/GB-month`);
        } catch (error) {
            console.log(`OpenSearch storage pricing error: ${error}`);
        }
        
        console.log('\n=== Testing EKS Pricing ===');
        const eksPrice = await pricingService.getEKSPricing(testRegion);
        console.log(`EKS cluster in ${testRegion}: $${eksPrice}/hour`);
        
        console.log('\n=== Testing EBS Storage Pricing ===');
        try {
            const ebsGp3Price = await pricingService.getEBSStoragePricing('gp3', testRegion);
            console.log(`EBS gp3 storage in ${testRegion}: $${ebsGp3Price}/GB-month`);
        } catch (error) {
            console.log(`EBS gp3 pricing error: ${error}`);
        }
        
        try {
            const ebsGp2Price = await pricingService.getEBSStoragePricing('gp2', testRegion);
            console.log(`EBS gp2 storage in ${testRegion}: $${ebsGp2Price}/GB-month`);
        } catch (error) {
            console.log(`EBS gp2 pricing error: ${error}`);
        }
        
    } catch (error) {
        console.error('Error testing pricing data:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    testPricingData().then(() => {
        console.log('\nPricing data test completed successfully!');
        process.exit(0);
    }).catch((error) => {
        console.error('Test failed:', error);
        process.exit(1);
    });
}
