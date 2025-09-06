require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const logger = require('./src/logger');
const VPNManager = require('./src/vpnManager');
const ProxyHandler = require('./src/proxyHandler');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Initialize VPN Manager and Proxy Handler
const vpnManager = new VPNManager();
const proxyHandler = new ProxyHandler(vpnManager);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later'
  }
});
app.use(limiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// VPN Management endpoints
app.get('/vpn/status', (req, res) => {
  try {
    const statuses = vpnManager.getAllStatuses();
    res.json({
      success: true,
      connections: statuses
    });
  } catch (error) {
    logger.error('Error getting VPN status:', error);
    res.status(500).json({
      error: 'Failed to get VPN status',
      message: error.message
    });
  }
});

app.post('/vpn/start', async (req, res) => {
  try {
    const { connectionId, protocol = 'tcp' } = req.body;
    
    if (!connectionId) {
      return res.status(400).json({
        error: 'Connection ID is required'
      });
    }

    if (!['tcp', 'udp'].includes(protocol)) {
      return res.status(400).json({
        error: 'Protocol must be either tcp or udp'
      });
    }

    const success = await vpnManager.startVPN(connectionId, protocol);
    
    res.json({
      success,
      connectionId,
      protocol,
      status: vpnManager.getStatus(connectionId),
      message: success ? 'VPN connection started successfully' : 'Failed to start VPN connection'
    });

  } catch (error) {
    logger.error('Error starting VPN:', error);
    res.status(500).json({
      error: 'Failed to start VPN connection',
      message: error.message
    });
  }
});

app.post('/vpn/stop', async (req, res) => {
  try {
    const { connectionId } = req.body;
    
    if (!connectionId) {
      return res.status(400).json({
        error: 'Connection ID is required'
      });
    }

    await vpnManager.stopVPN(connectionId);
    
    res.json({
      success: true,
      connectionId,
      status: vpnManager.getStatus(connectionId),
      message: 'VPN connection stopped successfully'
    });

  } catch (error) {
    logger.error('Error stopping VPN:', error);
    res.status(500).json({
      error: 'Failed to stop VPN connection',
      message: error.message
    });
  }
});

// Proxy endpoints for different websites/services
const endpoints = [
  { path: '/api/website1', connectionId: 'website1-tcp', protocol: 'tcp' },
  { path: '/api/website2', connectionId: 'website2-udp', protocol: 'udp' },
  { path: '/api/general', connectionId: 'general-tcp', protocol: 'tcp' }
];

// Create proxy endpoints
endpoints.forEach(({ path: endpointPath, connectionId, protocol }) => {
  // Handle all HTTP methods for each endpoint
  app.all(endpointPath, proxyHandler.createMiddleware(connectionId));
  
  // Auto-start VPN connection for this endpoint
  setTimeout(async () => {
    try {
      if (!vpnManager.isConnected(connectionId)) {
        logger.info(`Auto-starting VPN connection ${connectionId} for endpoint ${endpointPath}`);
        await vpnManager.startVPN(connectionId, protocol);
      }
    } catch (error) {
      logger.error(`Failed to auto-start VPN connection ${connectionId}:`, error);
    }
  }, 2000); // Delay to allow server startup
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.json({
    title: 'VPN Proxy Server API',
    version: '1.0.0',
    endpoints: {
      health: {
        method: 'GET',
        path: '/health',
        description: 'Server health check'
      },
      vpnStatus: {
        method: 'GET',
        path: '/vpn/status',
        description: 'Get status of all VPN connections'
      },
      startVpn: {
        method: 'POST',
        path: '/vpn/start',
        description: 'Start a VPN connection',
        body: {
          connectionId: 'string (required)',
          protocol: 'string (tcp|udp, default: tcp)'
        }
      },
      stopVpn: {
        method: 'POST',
        path: '/vpn/stop',
        description: 'Stop a VPN connection',
        body: {
          connectionId: 'string (required)'
        }
      },
      proxyEndpoints: endpoints.map(endpoint => ({
        method: 'ALL',
        path: endpoint.path,
        description: `Proxy requests through VPN connection ${endpoint.connectionId}`,
        usage: `${endpoint.path}?url=https://target-website.com`
      }))
    },
    examples: {
      proxyRequest: `curl "${req.protocol}://${req.get('host')}/api/website1?url=https://httpbin.org/ip"`,
      startVPN: `curl -X POST "${req.protocol}://${req.get('host')}/vpn/start" -H "Content-Type: application/json" -d '{"connectionId": "custom-connection", "protocol": "tcp"}'`
    }
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'VPN Proxy Server is running',
    documentation: '/api/docs',
    health: '/health',
    vpnStatus: '/vpn/status',
    availableEndpoints: endpoints.map(e => e.path)
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: endpoints.map(e => e.path),
    documentation: '/api/docs'
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  
  try {
    await vpnManager.shutdown();
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  
  try {
    await vpnManager.shutdown();
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Start server
app.listen(port, () => {
  logger.info(`VPN Proxy Server started on port ${port}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Available endpoints: ${endpoints.map(e => e.path).join(', ')}`);
  logger.info(`Documentation available at: http://localhost:${port}/api/docs`);
});

module.exports = app;