const axios = require('axios');
const logger = require('./logger');

class ProxyHandler {
  constructor(vpnManager) {
    this.vpnManager = vpnManager;
    this.timeout = parseInt(process.env.REQUEST_TIMEOUT) || 30000;
    this.maxRetries = parseInt(process.env.MAX_RETRIES) || 3;
  }

  /**
   * Handle proxy request through VPN
   * @param {string} connectionId - VPN connection identifier
   * @param {Object} requestConfig - Axios request configuration
   * @returns {Promise<Object>} - Response data
   */
  async handleRequest(connectionId, requestConfig) {
    // Ensure VPN connection is active
    if (!this.vpnManager.isConnected(connectionId)) {
      throw new Error(`VPN connection ${connectionId} is not active`);
    }

    const config = {
      timeout: this.timeout,
      validateStatus: () => true, // Don't throw on HTTP error codes
      ...requestConfig
    };

    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug(`Making request through VPN ${connectionId} (attempt ${attempt})`);
        
        const response = await axios(config);
        
        logger.info(`Request successful through VPN ${connectionId}: ${response.status} ${response.statusText}`);
        
        return {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: response.data
        };

      } catch (error) {
        lastError = error;
        logger.warn(`Request attempt ${attempt} failed through VPN ${connectionId}:`, error.message);

        // If VPN connection dropped, try to reconnect
        if (!this.vpnManager.isConnected(connectionId)) {
          logger.warn(`VPN connection ${connectionId} dropped during request`);
          break;
        }

        // Wait before retry
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    throw new Error(`Request failed after ${this.maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Create express middleware for proxying requests
   * @param {string} connectionId - VPN connection identifier
   * @returns {Function} - Express middleware
   */
  createMiddleware(connectionId) {
    return async (req, res, next) => {
      try {
        // Extract target URL from request
        const targetUrl = req.query.url || req.body.url;
        
        if (!targetUrl) {
          return res.status(400).json({
            error: 'Target URL is required',
            usage: 'Provide URL in query parameter: ?url=https://example.com'
          });
        }

        // Validate URL
        try {
          new URL(targetUrl);
        } catch {
          return res.status(400).json({
            error: 'Invalid URL format'
          });
        }

        // Prepare request configuration
        const requestConfig = {
          method: req.method,
          url: targetUrl,
          headers: { ...req.headers },
          params: { ...req.query },
          data: req.body
        };

        // Remove proxy-specific headers
        delete requestConfig.headers.host;
        delete requestConfig.headers['content-length'];
        delete requestConfig.params.url;

        // Make request through VPN
        const response = await this.handleRequest(connectionId, requestConfig);
        
        // Forward response
        res.status(response.status);
        
        // Set response headers (filter out some)
        Object.keys(response.headers).forEach(key => {
          if (!['transfer-encoding', 'connection', 'keep-alive'].includes(key.toLowerCase())) {
            res.set(key, response.headers[key]);
          }
        });

        res.json({
          success: true,
          vpnConnection: connectionId,
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: response.data
          }
        });

      } catch (error) {
        logger.error(`Proxy request failed for VPN ${connectionId}:`, error);
        
        res.status(500).json({
          error: 'Proxy request failed',
          message: error.message,
          vpnConnection: connectionId,
          vpnStatus: this.vpnManager.getStatus(connectionId)
        });
      }
    };
  }
}

module.exports = ProxyHandler;