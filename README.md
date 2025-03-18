# Somnia-bot

## 说明

Somnia-bot 是一个用于 Somnia 测试网的自动化工具，支持以下功能：
- **自动交换**：在 PING 和 PONG 代币之间进行自动化交换，支持余额检查。
- **领取水龙头**：。
- 通过 API 领取 Somnia 测试网的原生代币 STT。
- 通过合约领取 PING 和 PONG 代币。
- **发送代币**：将 STT 发送到随机地址或指定地址。


## 使用教程

### 1. 克隆

```bash
git clone https://github.com/ziqing888/Somnia-bot.git 
cd Somnia-bot
```
安装所需的 npm 包：
```bash
npm install
```
编辑 .env 文件：
替换 PRIVATE_KEY 为您的钱包私钥：
```bash
RPC_URL=https://dream-rpc.somnia.network
PRIVATE_KEY=0x您的私钥
PING_TOKEN_ADDRESS=0xbecd9b5f373877881d91cbdbaf013d97eb532154
PONG_TOKEN_ADDRESS=0x7968ac15a72629e05f41b8271e4e7292e0cc9f90
SWAP_CONTRACT_ADDRESS=0x6aac14f090a35eea150705f72d90e4cdc4a49b2c
NETWORK_NAME=Somnia 测试网
```
启动脚本：
```bash
npm start
```
