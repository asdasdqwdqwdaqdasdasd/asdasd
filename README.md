# Node.js VPN Proxy Server

A comprehensive Node.js server that connects to UK VPN servers using OpenVPN and provides REST API endpoints to route HTTP requests through the VPN connection.

## Features

- **OpenVPN Integration**: Connects to UK VPN servers using both TCP and UDP protocols
- **Multiple API Endpoints**: Support for simultaneous API endpoints routing through different VPN connections
- **Automatic Reconnection**: Handles VPN disconnections and automatically reconnects
- **Request Routing**: Routes all HTTP requests through the active VPN connection
- **Comprehensive Logging**: Detailed logging with Winston for monitoring and debugging
- **Error Handling**: Graceful error handling for VPN failures and network issues
- **Health Monitoring**: Built-in health checks and VPN status monitoring
- **Rate Limiting**: Protection against abuse with configurable rate limits

## Prerequisites

- Node.js (v16 or higher)
- OpenVPN client installed on the system
- Root/sudo privileges (required for OpenVPN)

### Installing OpenVPN

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install openvpn
```

**CentOS/RHEL:**
```bash
sudo yum install openvpn
```

**macOS:**
```bash
brew install openvpn
```

## Installation

1. Clone or download the project files
2. Install dependencies:
```bash
npm install
```

3. Ensure the logs directory exists:
```bash
mkdir -p logs
```

## Configuration

The server comes pre-configured with UK VPN server settings:

- **TCP Connection**: `145.239.255.68:80`
- **UDP Connection**: `145.239.255.68:53`
- **Credentials**: Username: `vpnbook`, Password: `m34wk9w`

### Environment Variables

Copy `.env` file and modify if needed:

```env
VPN_USERNAME=vpnbook
VPN_PASSWORD=m34wk9w
VPN_TCP_SERVER=145.239.255.68
VPN_TCP_PORT=80
VPN_UDP_SERVER=145.239.255.68
VPN_UDP_PORT=53
PORT=3000
NODE_ENV=development
REQUEST_TIMEOUT=30000
MAX_RETRIES=3
```

## Usage

### Starting the Server

```bash
# Production
npm start

# Development (with auto-reload)
npm run dev

# With sudo (required for OpenVPN)
sudo npm start
```

The server will start on `http://localhost:3000`

### API Endpoints

#### Health Check
```bash
GET /health
```

#### VPN Management

**Get VPN Status:**
```bash
GET /vpn/status
```

**Start VPN Connection:**
```bash
POST /vpn/start
Content-Type: application/json

{
  "connectionId": "my-connection",
  "protocol": "tcp"  // or "udp"
}
```

**Stop VPN Connection:**
```bash
POST /vpn/stop
Content-Type: application/json

{
  "connectionId": "my-connection"
}
```

#### Proxy Endpoints

The server provides multiple pre-configured proxy endpoints:

- `/api/website1` - TCP VPN connection
- `/api/website2` - UDP VPN connection  
- `/api/general` - General TCP VPN connection

**Making Proxy Requests:**

```bash
# GET request through VPN
curl "http://localhost:3000/api/website1?url=https://httpbin.org/ip"

# POST request through VPN
curl -X POST "http://localhost:3000/api/website1?url=https://httpbin.org/post" \
     -H "Content-Type: application/json" \
     -d '{"data": "test"}'
```

**Response Format:**
```json
{
  "success": true,
  "vpnConnection": "website1-tcp",
  "response": {
    "status": 200,
    "statusText": "OK",
    "headers": {...},
    "data": {...}
  }
}
```

### API Documentation

Visit `http://localhost:3000/api/docs` for complete API documentation.

## Examples

### Basic Usage

1. **Start the server:**
```bash
sudo npm start
```

2. **Check VPN status:**
```bash
curl http://localhost:3000/vpn/status
```

3. **Make a request through VPN:**
```bash
curl "http://localhost:3000/api/website1?url=https://httpbin.org/ip"
```

### Custom VPN Connection

```bash
# Start custom VPN connection
curl -X POST http://localhost:3000/vpn/start \
     -H "Content-Type: application/json" \
     -d '{"connectionId": "custom-tcp", "protocol": "tcp"}'

# Use custom endpoint (you'll need to create a custom route)
curl "http://localhost:3000/api/custom?url=https://example.com"
```

### Error Handling

The server handles various error scenarios:

- VPN connection failures
- Network timeouts
- Invalid URLs
- Rate limiting
- Server errors

Example error response:
```json
{
  "error": "Proxy request failed",
  "message": "VPN connection website1-tcp is not active",
  "vpnConnection": "website1-tcp",
  "vpnStatus": "disconnected"
}
```

## Logging

Logs are stored in the `logs/` directory:

- `combined.log` - All log messages
- `error.log` - Error messages only
- `vpn-{connectionId}.log` - Individual VPN connection logs

## Security Considerations

⚠️ **Important Security Notes:**

1. **Root Privileges**: OpenVPN requires root privileges to create network interfaces
2. **VPN Credentials**: Credentials are stored in plain text - consider using environment variables
3. **Network Security**: All traffic is routed through the VPN - ensure the VPN provider is trustworthy
4. **Rate Limiting**: Built-in rate limiting helps prevent abuse
5. **HTTPS**: Use HTTPS in production environments

## Troubleshooting

### Common Issues

1. **OpenVPN not found:**
   ```bash
   sudo apt install openvpn  # Ubuntu/Debian
   sudo yum install openvpn  # CentOS/RHEL
   ```

2. **Permission denied:**
   ```bash
   sudo npm start  # OpenVPN requires root privileges
   ```

3. **VPN connection fails:**
   - Check internet connectivity
   - Verify VPN server is accessible
   - Check firewall settings
   - Review logs in `logs/vpn-{connectionId}.log`

4. **Requests timing out:**
   - Verify VPN connection is active: `GET /vpn/status`
   - Check if target website is accessible
   - Increase `REQUEST_TIMEOUT` in `.env`

### Debug Mode

Enable debug logging:
```bash
NODE_ENV=development npm start
```

## License

MIT License - see LICENSE file for details.

## Disclaimer

This software is provided for educational and legitimate testing purposes only. Users are responsible for complying with all applicable laws and the terms of service of any VPN providers and target websites. The authors are not responsible for any misuse of this software.