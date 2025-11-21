// DynamoDB 백업 모듈 (Koyeb 환경용 경량 버전)
const { DynamoDBClient, CreateBackupCommand, ListBackupsCommand, DeleteBackupCommand } = require("@aws-sdk/client-dynamodb");

class BackupManager {
    constructor(awsConfig, tableName, retentionHours = 24) {
        this.dynamoClient = new DynamoDBClient({
            region: awsConfig.region,
            credentials: {
                accessKeyId: awsConfig.accessKeyId,
                secretAccessKey: awsConfig.secretAccessKey
            }
        });
        this.tableName = tableName;
        this.retentionHours = retentionHours;
        this.isRunning = false;
        this.intervalId = null;
    }

    // 백업 생성
    async createBackup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupName = `${this.tableName}-backup-${timestamp}`;
            
            const command = new CreateBackupCommand({
                TableName: this.tableName,
                BackupName: backupName
            });
            
            const response = await this.dynamoClient.send(command);
            console.log(`✅ [Backup] Created: ${backupName}`);
            
            return response.BackupDetails;
        } catch (error) {
            console.error('❌ [Backup] Create failed:', error.message);
            return null;
        }
    }

    // 오래된 백업 삭제
    async deleteOldBackups() {
        try {
            const command = new ListBackupsCommand({
                TableName: this.tableName
            });
            
            const response = await this.dynamoClient.send(command);
            const backups = response.BackupSummaries || [];
            
            const now = new Date();
            const retentionTime = this.retentionHours * 60 * 60 * 1000;
            
            let deletedCount = 0;
            
            for (const backup of backups) {
                const backupTime = new Date(backup.BackupCreationDateTime);
                const age = now - backupTime;
                
                if (age > retentionTime) {
                    try {
                        const deleteCommand = new DeleteBackupCommand({
                            BackupArn: backup.BackupArn
                        });
                        
                        await this.dynamoClient.send(deleteCommand);
                        console.log(`🗑️  [Backup] Deleted old: ${backup.BackupName}`);
                        deletedCount++;
                    } catch (deleteError) {
                        console.error(`❌ [Backup] Delete failed (${backup.BackupName}):`, deleteError.message);
                    }
                }
            }
            
            if (deletedCount > 0) {
                console.log(`✅ [Backup] Cleaned up ${deletedCount} old backups`);
            }
            
            return deletedCount;
        } catch (error) {
            console.error('❌ [Backup] List failed:', error.message);
            return 0;
        }
    }

    // 백업 작업 실행
    async runBackupJob() {
        console.log(`\n📦 [Backup] Starting job at ${new Date().toLocaleString('ko-KR')}`);
        
        try {
            await this.createBackup();
            await this.deleteOldBackups();
            console.log('✅ [Backup] Job completed\n');
        } catch (error) {
            console.error('❌ [Backup] Job failed:', error.message, '\n');
        }
    }

    // 자동 백업 시작 (5분마다)
    start() {
        if (this.isRunning) {
            console.log('⚠️  [Backup] Already running');
            return;
        }

        console.log('🚀 [Backup] Scheduler started');
        console.log(`   - Interval: 5 minutes`);
        console.log(`   - Retention: ${this.retentionHours} hours`);
        console.log(`   - Table: ${this.tableName}\n`);

        this.isRunning = true;
        
        // 5분마다 실행 (5 * 60 * 1000 ms)
        this.intervalId = setInterval(() => {
            this.runBackupJob();
        }, 5 * 60 * 1000);

        // 시작 후 10초 뒤 첫 백업 실행 (선택사항)
        // setTimeout(() => this.runBackupJob(), 10000);
    }

    // 자동 백업 중지
    stop() {
        if (!this.isRunning) {
            console.log('⚠️  [Backup] Not running');
            return;
        }

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
        console.log('🛑 [Backup] Scheduler stopped');
    }

    // 백업 통계 조회
    async getStats() {
        try {
            const command = new ListBackupsCommand({
                TableName: this.tableName
            });
            
            const response = await this.dynamoClient.send(command);
            const backups = response.BackupSummaries || [];
            
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('📊 Backup Statistics');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`Total backups: ${backups.length}`);
            
            if (backups.length > 0) {
                const totalSize = backups.reduce((sum, b) => sum + (b.BackupSizeBytes || 0), 0);
                console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
                
                const newest = backups[0];
                console.log(`\nNewest backup: ${newest.BackupName}`);
                console.log(`  Created: ${new Date(newest.BackupCreationDateTime).toLocaleString('ko-KR')}`);
            }
            
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            
            return backups;
        } catch (error) {
            console.error('❌ [Backup] Stats failed:', error.message);
            return [];
        }
    }
}

module.exports = BackupManager;
