const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class VPNManager {
  constructor() {
    this.connections = new Map();
    this.connectionStatus = new Map();
    this.reconnectAttempts = new Map();
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 5000;
  }

  /**
   * Start VPN connection
   * @param {string} connectionId - Unique identifier for the connection
   * @param {string} protocol - 'tcp' or 'udp'
   * @returns {Promise<boolean>} - Connection success status
   */
  async startVPN(connectionId, protocol = 'tcp') {
    if (this.isConnected(connectionId)) {
      logger.info(`VPN connection ${connectionId} is already active`);
      return true;
    }

    const configFile = protocol === 'tcp' ? 'vpn-tcp.ovpn' : 'vpn-udp.ovpn';
    const configPath = path.join(__dirname, '..', 'config', configFile);
    const authPath = path.join(__dirname, '..', 'config', 'auth.txt');

    if (!fs.existsSync(configPath)) {
      throw new Error(`VPN config file not found: ${configPath}`);
    }

    if (!fs.existsSync(authPath)) {
      throw new Error(`Auth file not found: ${authPath}`);
    }

    try {
      logger.info(`Starting VPN connection ${connectionId} with protocol ${protocol}`);
      
      const vpnProcess = spawn('openvpn', [
        '--config', configPath,
        '--daemon',
        '--log', `logs/vpn-${connectionId}.log`,
        '--writepid', `logs/vpn-${connectionId}.pid`
      ], {
        stdio: 'pipe'
      });

      vpnProcess.stdout.on('data', (data) => {
        logger.debug(`VPN ${connectionId} stdout: ${data}`);
      });

      vpnProcess.stderr.on('data', (data) => {
        logger.error(`VPN ${connectionId} stderr: ${data}`);
      });

      vpnProcess.on('error', (error) => {
        logger.error(`VPN ${connectionId} process error:`, error);
        this.connectionStatus.set(connectionId, 'error');
      });

      vpnProcess.on('exit', (code, signal) => {
        logger.info(`VPN ${connectionId} process exited with code ${code}, signal ${signal}`);
        this.connectionStatus.set(connectionId, 'disconnected');
        this.connections.delete(connectionId);
        
        // Auto-reconnect if not intentional disconnect
        if (code !== 0 && !signal) {
          this.attemptReconnect(connectionId, protocol);
        }
      });

      this.connections.set(connectionId, {
        process: vpnProcess,
        protocol,
        startTime: Date.now()
      });

      // Wait for connection to establish
      await this.waitForConnection(connectionId);
      
      logger.info(`VPN connection ${connectionId} established successfully`);
      return true;

    } catch (error) {
      logger.error(`Failed to start VPN connection ${connectionId}:`, error);
      this.connectionStatus.set(connectionId, 'error');
      throw error;
    }
  }

  /**
   * Stop VPN connection
   * @param {string} connectionId - Connection identifier
   */
  async stopVPN(connectionId) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      logger.warn(`No VPN connection found for ${connectionId}`);
      return;
    }

    try {
      logger.info(`Stopping VPN connection ${connectionId}`);
      connection.process.kill('SIGTERM');
      
      // Wait for graceful shutdown
      setTimeout(() => {
        if (this.connections.has(connectionId)) {
          connection.process.kill('SIGKILL');
        }
      }, 5000);

      this.connections.delete(connectionId);
      this.connectionStatus.set(connectionId, 'disconnected');
      this.reconnectAttempts.delete(connectionId);

    } catch (error) {
      logger.error(`Error stopping VPN connection ${connectionId}:`, error);
    }
  }

  /**
   * Check if VPN connection is active
   * @param {string} connectionId - Connection identifier
   * @returns {boolean} - Connection status
   */
  isConnected(connectionId) {
    return this.connectionStatus.get(connectionId) === 'connected';
  }

  /**
   * Get connection status
   * @param {string} connectionId - Connection identifier
   * @returns {string} - Status: 'connected', 'connecting', 'disconnected', 'error'
   */
  getStatus(connectionId) {
    return this.connectionStatus.get(connectionId) || 'disconnected';
  }

  /**
   * Get all connection statuses
   * @returns {Object} - Map of all connection statuses
   */
  getAllStatuses() {
    const statuses = {};
    for (const [id, status] of this.connectionStatus) {
      const connection = this.connections.get(id);
      statuses[id] = {
        status,
        protocol: connection?.protocol || 'unknown',
        uptime: connection ? Date.now() - connection.startTime : 0
      };
    }
    return statuses;
  }

  /**
   * Wait for VPN connection to establish
   * @param {string} connectionId - Connection identifier
   * @param {number} timeout - Timeout in milliseconds
   */
  async waitForConnection(connectionId, timeout = 30000) {
    this.connectionStatus.set(connectionId, 'connecting');
    
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkInterval = 1000;

      const checkConnection = async () => {
        if (Date.now() - startTime > timeout) {
          this.connectionStatus.set(connectionId, 'error');
          reject(new Error(`VPN connection ${connectionId} timeout`));
          return;
        }

        try {
          // Check if VPN interface is up (simplified check)
          const { exec } = require('child_process');
          exec('ip route | grep tun', (error, stdout) => {
            if (stdout && stdout.includes('tun')) {
              this.connectionStatus.set(connectionId, 'connected');
              resolve();
            } else {
              setTimeout(checkConnection, checkInterval);
            }
          });
        } catch (error) {
          setTimeout(checkConnection, checkInterval);
        }
      };

      checkConnection();
    });
  }

  /**
   * Attempt to reconnect VPN
   * @param {string} connectionId - Connection identifier
   * @param {string} protocol - VPN protocol
   */
  async attemptReconnect(connectionId, protocol) {
    const attempts = this.reconnectAttempts.get(connectionId) || 0;
    
    if (attempts >= this.maxReconnectAttempts) {
      logger.error(`Max reconnection attempts reached for VPN ${connectionId}`);
      return;
    }

    this.reconnectAttempts.set(connectionId, attempts + 1);
    logger.info(`Attempting to reconnect VPN ${connectionId} (attempt ${attempts + 1})`);

    setTimeout(async () => {
      try {
        await this.startVPN(connectionId, protocol);
        this.reconnectAttempts.delete(connectionId);
      } catch (error) {
        logger.error(`Reconnection attempt ${attempts + 1} failed for VPN ${connectionId}:`, error);
      }
    }, this.reconnectDelay);
  }

  /**
   * Clean shutdown of all VPN connections
   */
  async shutdown() {
    logger.info('Shutting down all VPN connections...');
    const connectionIds = Array.from(this.connections.keys());
    
    await Promise.all(
      connectionIds.map(id => this.stopVPN(id))
    );
  }
}

module.exports = VPNManager;