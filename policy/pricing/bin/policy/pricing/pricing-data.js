"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalAWSPricingService = void 0;
const fs = require("fs");
const path = require("path");
const https = require("https");
// Pricing data cache directory
const PRICING_DATA_DIR = path.join(__dirname, "pricing-data");
/**
 * Local AWS Pricing Service that downloads real pricing data from AWS
 */
class LocalAWSPricingService {
    constructor() {
        this.pricingData = null;
        this.dataFile = path.join(PRICING_DATA_DIR, "aws-pricing.json");
        this.ensureDataDirectory();
    }
    ensureDataDirectory() {
        if (!fs.existsSync(PRICING_DATA_DIR)) {
            fs.mkdirSync(PRICING_DATA_DIR, { recursive: true });
        }
    }
    downloadFile(url) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                console.log(`Downloading: ${url}`);
                https.get(url, (response) => {
                    if (response.statusCode !== 200) {
                        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                        return;
                    }
                    let data = '';
                    response.on('data', (chunk) => {
                        data += chunk;
                    });
                    response.on('end', () => {
                        resolve(data);
                    });
                }).on('error', (error) => {
                    reject(error);
                });
            });
        });
    }
    downloadPricingData() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log("Downloading real AWS pricing data from AWS Bulk Pricing API...");
            const pricingData = {
                ec2: {},
                rds: {},
                rdsStorage: {},
                eks: {},
                lastUpdated: new Date().toISOString()
            };
            // Regions to download pricing for
            const regions = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1'];
            try {
                // Download EC2 pricing for each region
                console.log("Downloading EC2 pricing data...");
                for (const region of regions) {
                    const ec2Url = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/${region}/index.json`;
                    try {
                        const ec2Data = yield this.downloadFile(ec2Url);
                        const ec2Pricing = JSON.parse(ec2Data);
                        pricingData.ec2[region] = {};
                        // Parse EC2 pricing data
                        for (const [sku, product] of Object.entries(ec2Pricing.products)) {
                            if (product.productFamily === 'Compute Instance' &&
                                product.attributes.instanceType &&
                                product.attributes.tenancy === 'Shared' &&
                                product.attributes.operatingSystem === 'Linux' &&
                                product.attributes.preInstalledSw === 'NA' &&
                                product.attributes.licenseModel === 'No License required') {
                                // Find the on-demand pricing
                                const onDemandTerms = ec2Pricing.terms.OnDemand;
                                if (onDemandTerms && onDemandTerms[sku]) {
                                    const termData = onDemandTerms[sku];
                                    if (termData) {
                                        for (const [termKey, term] of Object.entries(termData)) {
                                            if (term && term.priceDimensions) {
                                                for (const priceDimension of Object.values(term.priceDimensions)) {
                                                    if (priceDimension &&
                                                        priceDimension.unit === 'Hrs' &&
                                                        priceDimension.pricePerUnit &&
                                                        priceDimension.pricePerUnit.USD) {
                                                        const priceUSD = parseFloat(priceDimension.pricePerUnit.USD);
                                                        if (!isNaN(priceUSD) && priceUSD > 0) {
                                                            const instanceType = product.attributes.instanceType;
                                                            // Only store if we don't have this instance type yet, or if this price is better
                                                            if (!pricingData.ec2[region][instanceType] ||
                                                                pricingData.ec2[region][instanceType] === 0) {
                                                                pricingData.ec2[region][instanceType] = priceUSD;
                                                            }
                                                        }
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        console.log(`Downloaded EC2 pricing for ${region}: ${Object.keys(pricingData.ec2[region]).length} instance types`);
                    }
                    catch (error) {
                        console.warn(`Failed to download EC2 pricing for ${region}:`, error);
                    }
                }
                // Download RDS pricing for each region
                console.log("Downloading RDS pricing data...");
                for (const region of regions) {
                    const rdsUrl = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/${region}/index.json`;
                    try {
                        const rdsData = yield this.downloadFile(rdsUrl);
                        const rdsPricing = JSON.parse(rdsData);
                        pricingData.rds[region] = {};
                        pricingData.rdsStorage[region] = {};
                        // Parse RDS pricing data
                        for (const [sku, product] of Object.entries(rdsPricing.products)) {
                            if (product.productFamily === 'Database Instance' &&
                                product.attributes.instanceType &&
                                product.attributes.databaseEngine &&
                                product.attributes.deploymentOption &&
                                product.attributes.deploymentOption.includes('Multi-AZ')) {
                                // Extract instance class from instanceType (e.g., "db.r5.2xlarge" -> "db.r5.2xlarge")
                                const instanceType = product.attributes.instanceType;
                                const engine = product.attributes.databaseEngine;
                                if (!pricingData.rds[region][instanceType]) {
                                    pricingData.rds[region][instanceType] = {};
                                }
                                // Find the on-demand pricing
                                const onDemandTerms = rdsPricing.terms.OnDemand;
                                if (onDemandTerms && onDemandTerms[sku]) {
                                    const termData = onDemandTerms[sku];
                                    if (termData) {
                                        for (const [termKey, term] of Object.entries(termData)) {
                                            if (term && term.priceDimensions) {
                                                for (const priceDimension of Object.values(term.priceDimensions)) {
                                                    if (priceDimension && priceDimension.unit === 'Hrs' && priceDimension.pricePerUnit && priceDimension.pricePerUnit.USD) {
                                                        const priceUSD = parseFloat(priceDimension.pricePerUnit.USD);
                                                        if (!isNaN(priceUSD)) {
                                                            // Store the price, preferring lower prices if multiple exist
                                                            if (!pricingData.rds[region][instanceType][engine] ||
                                                                pricingData.rds[region][instanceType][engine] > priceUSD) {
                                                                pricingData.rds[region][instanceType][engine] = priceUSD;
                                                            }
                                                        }
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            else if (product.productFamily === 'Database Storage' &&
                                product.attributes.volumeType) {
                                const storageType = product.attributes.volumeType;
                                // Find the on-demand pricing
                                const onDemandTerms = rdsPricing.terms.OnDemand;
                                if (onDemandTerms && onDemandTerms[sku]) {
                                    const termData = onDemandTerms[sku];
                                    if (termData) {
                                        for (const [termKey, term] of Object.entries(termData)) {
                                            if (term && term.priceDimensions) {
                                                for (const priceDimension of Object.values(term.priceDimensions)) {
                                                    if (priceDimension && priceDimension.unit === 'GB-Mo' && priceDimension.pricePerUnit && priceDimension.pricePerUnit.USD) {
                                                        const priceUSD = parseFloat(priceDimension.pricePerUnit.USD);
                                                        if (!isNaN(priceUSD)) {
                                                            // Map AWS storage types to our simplified names
                                                            let mappedStorageType = storageType;
                                                            if (storageType === 'General Purpose')
                                                                mappedStorageType = 'gp2';
                                                            else if (storageType === 'General Purpose-GP3')
                                                                mappedStorageType = 'gp3';
                                                            else if (storageType === 'Provisioned IOPS')
                                                                mappedStorageType = 'io1';
                                                            else if (storageType === 'Magnetic')
                                                                mappedStorageType = 'standard';
                                                            pricingData.rdsStorage[region][mappedStorageType] = priceUSD;
                                                        }
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        console.log(`Downloaded RDS pricing for ${region}: ${Object.keys(pricingData.rds[region]).length} instance classes`);
                    }
                    catch (error) {
                        console.warn(`Failed to download RDS pricing for ${region}:`, error);
                    }
                }
                // Download EKS pricing (simpler as it's a flat rate per cluster per hour)
                console.log("Setting EKS pricing data...");
                // EKS pricing is $0.10 per cluster per hour in all regions
                for (const region of regions) {
                    pricingData.eks[region] = 0.10;
                }
                // Validate that we have some pricing data
                const hasEC2Data = Object.keys(pricingData.ec2).some(region => Object.keys(pricingData.ec2[region]).length > 0);
                const hasRDSData = Object.keys(pricingData.rds).some(region => Object.keys(pricingData.rds[region]).length > 0);
                if (!hasEC2Data && !hasRDSData) {
                    throw new Error("Failed to download any pricing data from AWS");
                }
                // Save the pricing data
                fs.writeFileSync(this.dataFile, JSON.stringify(pricingData, null, 2));
                this.pricingData = pricingData;
                console.log("AWS pricing data downloaded and cached successfully.");
            }
            catch (error) {
                console.error("Error downloading AWS pricing data:", error);
                throw new Error(`Failed to download AWS pricing data: ${error}`);
            }
        });
    }
    loadPricingData() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.pricingData) {
                return;
            }
            // Check if we have cached data
            if (fs.existsSync(this.dataFile)) {
                try {
                    const data = fs.readFileSync(this.dataFile, 'utf8');
                    this.pricingData = JSON.parse(data);
                    // Check if data is older than 7 days
                    const lastUpdated = new Date(this.pricingData.lastUpdated);
                    const now = new Date();
                    const daysDiff = (now.getTime() - lastUpdated.getTime()) / (1000 * 3600 * 24);
                    if (daysDiff > 7) {
                        console.log("Pricing data is older than 7 days, refreshing...");
                        yield this.downloadPricingData();
                    }
                    else {
                        console.log("Using cached pricing data from", lastUpdated.toISOString());
                    }
                }
                catch (error) {
                    console.log("Failed to load cached pricing data, downloading fresh data...");
                    yield this.downloadPricingData();
                }
            }
            else {
                yield this.downloadPricingData();
            }
        });
    }
    /**
     * Normalize engine name to match AWS pricing data format
     * Handles case conversion and common engine name variations
     */
    normalizeEngineName(inputEngine, availableEngines) {
        const lowerInput = inputEngine.toLowerCase();
        // Direct case-insensitive match first
        for (const engine of availableEngines) {
            if (engine.toLowerCase() === lowerInput) {
                return engine;
            }
        }
        // Handle common engine name mappings
        const engineMappings = {
            'mysql': ['MySQL', 'Aurora MySQL'],
            'postgresql': ['PostgreSQL', 'Aurora PostgreSQL'],
            'postgres': ['PostgreSQL', 'Aurora PostgreSQL'],
            'oracle': ['Oracle'],
            'sqlserver': ['SQL Server'],
            'sql-server': ['SQL Server'],
            'mariadb': ['MariaDB'],
            'aurora-mysql': ['Aurora MySQL'],
            'aurora-postgresql': ['Aurora PostgreSQL'],
            'aurora-postgres': ['Aurora PostgreSQL'],
            'db2': ['Db2']
        };
        // Try to find a mapping for the lowercase input
        const possibleEngines = engineMappings[lowerInput];
        if (possibleEngines) {
            for (const possibleEngine of possibleEngines) {
                // Case-insensitive search in available engines
                for (const availableEngine of availableEngines) {
                    if (availableEngine.toLowerCase() === possibleEngine.toLowerCase()) {
                        return availableEngine;
                    }
                }
            }
        }
        // If no exact match found, try partial matching (case-insensitive)
        for (const engine of availableEngines) {
            const lowerEngine = engine.toLowerCase();
            if (lowerEngine.includes(lowerInput) || lowerInput.includes(lowerEngine)) {
                return engine;
            }
        }
        // No match found
        throw new Error(`Engine '${inputEngine}' not found. Available engines: ${availableEngines.join(', ')}`);
    }
    /**
     * Normalize storage type name to match AWS pricing data format
     * Handles case conversion and common storage type variations
     */
    normalizeStorageType(inputStorageType, availableStorageTypes) {
        const lowerInput = inputStorageType.toLowerCase();
        // Direct case-insensitive match first
        for (const storageType of availableStorageTypes) {
            if (storageType.toLowerCase() === lowerInput) {
                return storageType;
            }
        }
        // Handle common storage type name mappings
        const storageTypeMappings = {
            'gp2': ['gp2'],
            'gp3': ['gp3'],
            'io1': ['io1'],
            'io2': ['io2'],
            'standard': ['standard'],
            'magnetic': ['standard']
        };
        // Try to find a mapping for the lowercase input
        const possibleStorageTypes = storageTypeMappings[lowerInput];
        if (possibleStorageTypes) {
            for (const possibleStorageType of possibleStorageTypes) {
                // Case-insensitive search in available storage types
                for (const availableStorageType of availableStorageTypes) {
                    if (availableStorageType.toLowerCase() === possibleStorageType.toLowerCase()) {
                        return availableStorageType;
                    }
                }
            }
        }
        // If no exact match found, try partial matching (case-insensitive)
        for (const storageType of availableStorageTypes) {
            const lowerStorageType = storageType.toLowerCase();
            if (lowerStorageType.includes(lowerInput) || lowerInput.includes(lowerStorageType)) {
                return storageType;
            }
        }
        // No match found
        throw new Error(`Storage type '${inputStorageType}' not found. Available storage types: ${availableStorageTypes.join(', ')}`);
    }
    getEC2Pricing(instanceType, region) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.loadPricingData();
            const regionData = this.pricingData.ec2[region];
            if (!regionData) {
                throw new Error(`No EC2 pricing data available for region: ${region}`);
            }
            const price = regionData[instanceType];
            if (price === undefined) {
                throw new Error(`No EC2 pricing data available for instance type: ${instanceType} in region: ${region}`);
            }
            return price;
        });
    }
    getRDSPricing(instanceType, engine, region) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.loadPricingData();
            const regionData = this.pricingData.rds[region];
            if (!regionData) {
                throw new Error(`No RDS pricing data available for region: ${region}`);
            }
            const instanceData = regionData[instanceType];
            if (!instanceData) {
                throw new Error(`No RDS pricing data available for instance type: ${instanceType} in region: ${region}`);
            }
            // Get available engines for this instance type
            const availableEngines = Object.keys(instanceData);
            // Normalize the engine name to match AWS format
            const normalizedEngine = this.normalizeEngineName(engine, availableEngines);
            const price = instanceData[normalizedEngine];
            if (price === undefined) {
                throw new Error(`No RDS pricing data available for engine: ${engine} on instance type: ${instanceType} in region: ${region}. Available engines: ${availableEngines.join(', ')}`);
            }
            return price;
        });
    }
    getRDSStoragePricing(storageType, region) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.loadPricingData();
            const regionData = this.pricingData.rdsStorage[region];
            if (!regionData) {
                throw new Error(`No RDS storage pricing data available for region: ${region}`);
            }
            // Get available storage types for this region
            const availableStorageTypes = Object.keys(regionData);
            // Normalize the storage type name to match AWS format
            const normalizedStorageType = this.normalizeStorageType(storageType, availableStorageTypes);
            const price = regionData[normalizedStorageType];
            if (price === undefined) {
                throw new Error(`No RDS storage pricing data available for storage type: ${storageType} in region: ${region}. Available storage types: ${availableStorageTypes.join(', ')}`);
            }
            return price;
        });
    }
    getEKSPricing(region) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.loadPricingData();
            const price = this.pricingData.eks[region];
            if (price === undefined) {
                throw new Error(`No EKS pricing data available for region: ${region}`);
            }
            return price;
        });
    }
    // Method to force refresh the pricing data
    refreshPricingData() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.downloadPricingData();
        });
    }
}
exports.LocalAWSPricingService = LocalAWSPricingService;
//# sourceMappingURL=pricing-data.js.map