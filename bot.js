import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
import { ethers } from "ethers";
import fs from "fs";
import readline from "readline";
import chalk from "chalk";

// 配置
const RPC_URL = process.env.RPC_URL || "https://dream-rpc.somnia.network";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const PING_TOKEN_ADDRESS = process.env.PING_TOKEN_ADDRESS || "0xbecd9b5f373877881d91cbdbaf013d97eb532154";
const PONG_TOKEN_ADDRESS = process.env.PONG_TOKEN_ADDRESS || "0x7968ac15a72629e05f41b8271e4e7292e0cc9f90";
const SWAP_CONTRACT_ADDRESS = process.env.SWAP_CONTRACT_ADDRESS || "0x6aac14f090a35eea150705f72d90e4cdc4a49b2c";
const NETWORK_NAME = process.env.NETWORK_NAME || "Somnia 测试网";

const swapContractABI = [
  {
    "inputs": [
      {
        "components": [
          { "internalType": "address", "name": "tokenIn", "type": "address" },
          { "internalType": "address", "name": "tokenOut", "type": "address" },
          { "internalType": "uint24", "name": "fee", "type": "uint24" },
          { "internalType": "address", "name": "recipient", "type": "address" },
          { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
          { "internalType": "uint256", "name": "amountOutMinimum", "type": "uint256" },
          { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" }
        ],
        "internalType": "struct ExactInputSingleParams",
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "exactInputSingle",
    "outputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }],
    "stateMutability": "payable",
    "type": "function"
  }
];

const PING_ABI = [
  "function mint(address to, uint256 amount) public payable",
  "function balanceOf(address owner) view returns (uint256)"
];

const PONG_ABI = [
  "function mint(address to, uint256 amount) public payable",
  "function balanceOf(address owner) view returns (uint256)"
];

// 全局变量
let walletInfo = {
  address: "",
  balanceNative: "0.00",
  balancePing: "0.00",
  balancePong: "0.00",
  network: NETWORK_NAME,
};
let autoSwapRunning = false;
let autoSwapCancelled = false;
let claimFaucetRunning = false;
let claimFaucetCancelled = false;
let autoSendRunning = false;
let autoSendCancelled = false;
let globalWallet = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 日志函数
function addLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  let coloredMessage = message.includes("成功") ? chalk.green(message) :
                       message.includes("失败") || message.includes("出错") ? chalk.red(message) :
                       chalk.cyan(message);
  console.log(`${chalk.gray(timestamp)}  ${coloredMessage}`);
}

// 工具函数
function getShortAddress(address) {
  return address.slice(0, 6) + "..." + address.slice(-4);
}
function getShortHash(hash) {
  return hash.slice(0, 6) + "..." + hash.slice(-4);
}
function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function delay(ms) {
  return Promise.race([
    new Promise(resolve => setTimeout(resolve, ms)),
    new Promise(resolve => {
      const interval = setInterval(() => {
        if (autoSwapCancelled || autoSendCancelled) {
          clearInterval(interval);
          resolve();
        }
      }, 1);
    })
  ]);
}
function getTokenName(address) {
  if (address.toLowerCase() === PING_TOKEN_ADDRESS.toLowerCase()) return "Ping";
  if (address.toLowerCase() === PONG_TOKEN_ADDRESS.toLowerCase()) return "Pong";
  return address;
}

// 领取水龙头
async function claimFaucetPing() {
  if (claimFaucetRunning) {
    addLog("PING 水龙头请求已在进行中。");
    return;
  }
  claimFaucetRunning = true;
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    let pk = PRIVATE_KEY.trim();
    if (!pk.startsWith("0x")) pk = "0x" + pk;
    const wallet = new ethers.Wallet(pk, provider);
    const pingContract = new ethers.Contract(PING_TOKEN_ADDRESS, PING_ABI, wallet);
    const claimAmount = ethers.parseUnits("1000", 18);
    addLog("正在请求 PING 水龙头...");
    const tx = await pingContract.mint(wallet.address, claimAmount, { value: 0 });
    addLog(`交易已发送。交易哈希: ${getShortHash(tx.hash)}`);
    await tx.wait();
    addLog("PING 水龙头领取成功！");
    await delay(5000);
    await updateWalletData();
  } catch (error) {
    addLog("PING 水龙头领取失败: " + error.message);
  } finally {
    claimFaucetRunning = false;
  }
}

async function claimFaucetPong() {
  if (claimFaucetRunning) {
    addLog("PONG 水龙头请求已在进行中。");
    return;
  }
  claimFaucetRunning = true;
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    let pk = PRIVATE_KEY.trim();
    if (!pk.startsWith("0x")) pk = "0x" + pk;
    const wallet = new ethers.Wallet(pk, provider);
    const pongContract = new ethers.Contract(PONG_TOKEN_ADDRESS, PONG_ABI, wallet);
    const claimAmount = ethers.parseUnits("1000", 18);
    addLog("正在请求 PONG 水龙头...");
    const tx = await pongContract.mint(wallet.address, claimAmount, { value: 0 });
    addLog(`交易已发送。交易哈希: ${getShortHash(tx.hash)}`);
    await tx.wait();
    addLog("PONG 水龙头领取成功！");
    await delay(5000);
    await updateWalletData();
  } catch (error) {
    addLog("PONG 水龙头领取失败: " + error.message);
  } finally {
    claimFaucetRunning = false;
  }
}

// 更新钱包数据
async function updateWalletData() {
  try {
    if (!RPC_URL || !PRIVATE_KEY) throw new Error("RPC_URL 或 PRIVATE_KEY 未在 .env 中定义");
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    let pk = PRIVATE_KEY.trim();
    if (!pk.startsWith("0x")) pk = "0x" + pk;
    const wallet = new ethers.Wallet(pk, provider);
    globalWallet = wallet;
    walletInfo.address = wallet.address;
    const balanceNative = await provider.getBalance(wallet.address);
    walletInfo.balanceNative = ethers.formatEther(balanceNative);
    if (PING_TOKEN_ADDRESS) {
      const pingContract = new ethers.Contract(PING_TOKEN_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
      const pingBalance = await pingContract.balanceOf(wallet.address);
      walletInfo.balancePing = ethers.formatEther(pingBalance);
    }
    if (PONG_TOKEN_ADDRESS) {
      const pongContract = new ethers.Contract(PONG_TOKEN_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider);
      const pongBalance = await pongContract.balanceOf(wallet.address);
      walletInfo.balancePong = ethers.formatEther(pongBalance);
    }
    addLog(`钱包信息 - 地址: ${getShortAddress(walletInfo.address)}, 原生代币: ${walletInfo.balanceNative}, Ping: ${walletInfo.balancePing}, Pong: ${walletInfo.balancePong}, 网络: ${walletInfo.network}`);
  } catch (error) {
    addLog("无法获取钱包数据: " + error.message);
  }
}

// 检查并授权代币
async function checkAndApproveToken(tokenAddress, spender, amount) {
  const erc20ABI = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)"
  ];
  const tokenContract = new ethers.Contract(tokenAddress, erc20ABI, globalWallet);
  const currentAllowance = await tokenContract.allowance(globalWallet.address, spender);
  if (currentAllowance < amount) {
    addLog(`需要为代币 ${getShortAddress(tokenAddress)} 授权。当前授权额度: ${ethers.formatEther(currentAllowance)}`);
    const maxApproval = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    const tx = await tokenContract.approve(spender, maxApproval);
    addLog(`授权交易已发送: ${getShortHash(tx.hash)}`);
    await tx.wait();
    addLog("授权成功。");
  } else {
    addLog("代币已授权。");
  }
}

// 自动交换
async function autoSwapPingPong(totalSwaps) {
  try {
    if (!globalWallet) throw new Error("钱包尚未初始化。");
    const swapContract = new ethers.Contract(SWAP_CONTRACT_ADDRESS, swapContractABI, globalWallet);
    addLog(`开始自动交换 ${totalSwaps} 次。`);
    for (let i = 0; i < totalSwaps; i++) {
      if (autoSwapCancelled) {
        addLog("自动交换已取消。");
        break;
      }
      const swapDirection = Math.random() < 0.5 ? "PongToPing" : "PingToPong";
      let tokenIn = swapDirection === "PongToPing" ? PONG_TOKEN_ADDRESS : PING_TOKEN_ADDRESS;
      let tokenOut = swapDirection === "PongToPing" ? PING_TOKEN_ADDRESS : PONG_TOKEN_ADDRESS;
      const randomAmount = randomInRange(100, 500);
      const amountIn = ethers.parseUnits(randomAmount.toString(), 18);
      const tokenInName = getTokenName(tokenIn);
      const tokenOutName = getTokenName(tokenOut);
      addLog(`交换 ${i + 1}/${totalSwaps}: 从 ${tokenInName} 到 ${tokenOutName}，数量 ${randomAmount}`);
      await checkAndApproveToken(tokenIn, SWAP_CONTRACT_ADDRESS, amountIn);
      const tx = await swapContract.exactInputSingle({
        tokenIn,
        tokenOut,
        fee: 500,
        recipient: globalWallet.address,
        amountIn,
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0n
      });
      addLog(`交换 ${i + 1}/${totalSwaps} 交易已发送: ${getShortHash(tx.hash)}`);
      await tx.wait();
      addLog(`交换 ${i + 1}/${totalSwaps} 成功。`);
      await updateWalletData();
      if (i < totalSwaps - 1) {
        const delayMs = randomInRange(20000, 50000);
        addLog(`等待 ${delayMs / 1000} 秒后进行下一次交换...`);
        await delay(delayMs);
      }
    }
    addLog("自动交换完成。");
  } catch (err) {
    addLog("自动交换出错: " + err.message);
  } finally {
    autoSwapRunning = false;
  }
}

// 读取随机地址
function readRandomAddresses() {
  try {
    const data = fs.readFileSync("randomaddress.txt", "utf8");
    return data.split("\n").map(addr => addr.trim()).filter(addr => addr !== "");
  } catch (err) {
    addLog("无法读取 randomaddress.txt 文件: " + err.message);
    return [];
  }
}

// 自动发送到随机地址
async function autoSendTokenRandom(totalSends, tokenAmountStr) {
  try {
    if (!globalWallet) throw new Error("钱包尚未初始化。");
    const addresses = readRandomAddresses();
    if (addresses.length === 0) {
      addLog("地址列表为空。");
      return;
    }
    addLog(`开始自动发送代币至随机地址 ${totalSends} 次。`);
    for (let i = 0; i < totalSends; i++) {
      if (autoSendCancelled) {
        addLog("自动发送代币已取消。");
        break;
      }
      const randomIndex = randomInRange(0, addresses.length - 1);
      const targetAddress = addresses[randomIndex];
      addLog(`自动发送: 发送 ${tokenAmountStr} STT 到 ${targetAddress}`);
      const tx = await globalWallet.sendTransaction({
        to: targetAddress,
        value: ethers.parseUnits(tokenAmountStr, 18)
      });
      addLog(`自动发送 ${i + 1}/${totalSends} 交易已发送: ${getShortHash(tx.hash)}`);
      await tx.wait();
      addLog(`自动发送 ${i + 1}/${totalSends} 成功到 ${targetAddress}。`);
      await updateWalletData();
      if (i < totalSends - 1) {
        const delayMs = randomInRange(5000, 10000);
        addLog(`等待 ${delayMs / 1000} 秒后进行下一次发送...`);
        await delay(delayMs);
      }
    }
    addLog("自动发送代币完成。");
  } catch (err) {
    addLog("自动发送代币出错: " + err.message);
  } finally {
    autoSendRunning = false;
  }
}

// 发送到指定地址
async function autoSendTokenChosen(targetAddress, tokenAmountStr) {
  try {
    if (!globalWallet) throw new Error("钱包尚未初始化。");
    addLog(`发送 ${tokenAmountStr} STT 到地址 ${targetAddress}`);
    const tx = await globalWallet.sendTransaction({
      to: targetAddress,
      value: ethers.parseUnits(tokenAmountStr, 18)
    });
    addLog(`交易已发送。交易哈希: ${getShortHash(tx.hash)}`);
    await tx.wait();
    addLog(`发送代币到 ${targetAddress} 成功。`);
    await updateWalletData();
  } catch (err) {
    addLog("发送代币出错: " + err.message);
  } finally {
    autoSendRunning = false;
  }
}

// 主菜单
async function showMainMenu() {
  console.log(chalk.bold.green("\n=================== SOMNIA AUTO SWAP ==================="));
  console.log(chalk.blue(`钱包: ${getShortAddress(walletInfo.address)} | STT: ${walletInfo.balanceNative} | Ping: ${walletInfo.balancePing} | Pong: ${walletInfo.balancePong}`));
  console.log(chalk.green("-------------------------------------------------------"));
  console.log(chalk.yellow("  1. Somnia 自动交换"));
  console.log(chalk.yellow("  2. 领取水龙头"));
  console.log(chalk.yellow("  3. 自动发送代币"));
  console.log(chalk.yellow("  4. 刷新"));
  console.log(chalk.red("  5. 退出"));
  console.log(chalk.green("-------------------------------------------------------"));
  rl.question(chalk.white("请选择操作 (1-5): "), async (choice) => {
    switch (choice) {
      case "1":
        await showSomniaSubMenu();
        break;
      case "2":
        await showFaucetSubMenu();
        break;
      case "3":
        await showSendTokenSubMenu();
        break;
      case "4":
        await updateWalletData();
        await showMainMenu();
        break;
      case "5":
        console.log(chalk.red("退出程序"));
        process.exit(0);
        break;
      default:
        addLog("无效选项");
        await showMainMenu();
    }
  });
}

// Somnia 自动交换菜单
async function showSomniaSubMenu() {
  console.log(chalk.bold.green("\n=== Somnia 自动交换菜单 ==="));
  console.log(chalk.yellow("  1. 自动交换 PING 和 PONG"));
  if (autoSwapRunning) console.log(chalk.yellow("  2. 停止交易"));
  console.log(chalk.yellow(`  ${autoSwapRunning ? "3" : "2"}. 返回主菜单`));
  console.log(chalk.red(`  ${autoSwapRunning ? "4" : "3"}. 退出`));
  rl.question(chalk.white(`请选择操作 (1-${autoSwapRunning ? "4" : "3"}): `), async (choice) => {
    if (choice === "1") {
      if (autoSwapRunning) {
        addLog("交易已在进行中，无法启动新交易。");
        await showSomniaSubMenu();
        return;
      }
      rl.question(chalk.white("请输入交换次数 (回车取消): "), async (value) => {
        if (!value) {
          await showSomniaSubMenu();
          return;
        }
        const totalSwaps = parseInt(value);
        if (isNaN(totalSwaps) || totalSwaps <= 0) {
          addLog("交换次数无效。");
          await showSomniaSubMenu();
          return;
        }
        autoSwapRunning = true;
        autoSwapCancelled = false;
        await autoSwapPingPong(totalSwaps);
        autoSwapRunning = false;
        await showSomniaSubMenu();
      });
    } else if (choice === "2" && autoSwapRunning) {
      autoSwapCancelled = true;
      addLog("已接收停止交易命令 (Somnia)。");
      await showSomniaSubMenu();
    } else if ((!autoSwapRunning && choice === "2") || (autoSwapRunning && choice === "3")) {
      await showMainMenu();
    } else if ((!autoSwapRunning && choice === "3") || (autoSwapRunning && choice === "4")) {
      console.log(chalk.red("退出程序"));
      process.exit(0);
    } else {
      addLog("无效选项");
      await showSomniaSubMenu();
    }
  });
}

// 水龙头菜单
async function showFaucetSubMenu() {
  console.log(chalk.bold.green("\n=== 水龙头领取菜单 ==="));
  console.log(chalk.yellow((autoSwapRunning || claimFaucetRunning) ? "  1. 领取 PING 水龙头 (已禁用)" : "  1. 领取 PING 水龙头"));
  console.log(chalk.yellow((autoSwapRunning || claimFaucetRunning) ? "  2. 领取 PONG 水龙头 (已禁用)" : "  2. 领取 PONG 水龙头"));
  if (autoSwapRunning || claimFaucetRunning) console.log(chalk.yellow("  3. 停止交易"));
  console.log(chalk.yellow(`  ${(autoSwapRunning || claimFaucetRunning) ? "4" : "3"}. 返回主菜单`));
  console.log(chalk.red(`  ${(autoSwapRunning || claimFaucetRunning) ? "5" : "4"}. 退出`));
  rl.question(chalk.white(`请选择操作 (1-${(autoSwapRunning || claimFaucetRunning) ? "5" : "4"}): `), async (choice) => {
    if ((autoSwapRunning || claimFaucetRunning) && (choice === "1" || choice === "2")) {
      addLog("交易进行中，请先停止交易再领取水龙头。");
      await showFaucetSubMenu();
    } else if (choice === "1") {
      await claimFaucetPing();
      await showFaucetSubMenu();
    } else if (choice === "2") {
      await claimFaucetPong();
      await showFaucetSubMenu();
    } else if (choice === "3" && (autoSwapRunning || claimFaucetRunning)) {
      claimFaucetCancelled = true;
      addLog("已接收停止交易命令 (水龙头)。");
      await showFaucetSubMenu();
    } else if ((!autoSwapRunning && !claimFaucetRunning && choice === "3") || (choice === "4" && (autoSwapRunning || claimFaucetRunning))) {
      await showMainMenu();
    } else if ((!autoSwapRunning && !claimFaucetRunning && choice === "4") || (choice === "5" && (autoSwapRunning || claimFaucetRunning))) {
      console.log(chalk.red("退出程序"));
      process.exit(0);
    } else {
      addLog("无效选项");
      await showFaucetSubMenu();
    }
  });
}

// 发送代币菜单
async function showSendTokenSubMenu() {
  console.log(chalk.bold.green("\n=== 自动发送代币菜单 ==="));
  console.log(chalk.yellow(autoSendRunning ? "  1. 自动发送至随机地址 (已禁用)" : "  1. 自动发送至随机地址"));
  console.log(chalk.yellow(autoSendRunning ? "  2. 发送至指定地址 (已禁用)" : "  2. 发送至指定地址"));
  if (autoSendRunning) console.log(chalk.yellow("  3. 停止交易"));
  console.log(chalk.yellow(`  ${autoSendRunning ? "4" : "3"}. 返回主菜单`));
  console.log(chalk.red(`  ${autoSendRunning ? "5" : "4"}. 退出`));
  rl.question(chalk.white(`请选择操作 (1-${autoSendRunning ? "5" : "4"}): `), async (choice) => {
    if (choice === "1" && !autoSendRunning) {
      rl.question(chalk.white("请输入发送次数 (回车取消): "), (totalSendsStr) => {
        if (!totalSendsStr) {
          showSendTokenSubMenu();
          return;
        }
        const totalSends = parseInt(totalSendsStr);
        if (isNaN(totalSends) || totalSends <= 0) {
          addLog("发送次数无效。");
          showSendTokenSubMenu();
          return;
        }
        rl.question(chalk.white("请输入每次发送的代币数量 (STT，最小 0.0001，最大 0.01，回车取消): "), async (tokenAmt) => {
          if (!tokenAmt) {
            await showSendTokenSubMenu();
            return;
          }
          let amt = parseFloat(tokenAmt);
          if (isNaN(amt) || amt < 0.0001 || amt > 0.01) {
            addLog("代币数量无效，必须在 0.0001 到 0.01 STT 之间。");
            await showSendTokenSubMenu();
            return;
          }
          autoSendRunning = true;
          autoSendCancelled = false;
          await autoSendTokenRandom(totalSends, tokenAmt);
          autoSendRunning = false;
          await showSendTokenSubMenu();
        });
      });
    } else if (choice === "2" && !autoSendRunning) {
      rl.question(chalk.white("请输入目标地址 (回车取消): "), (target) => {
        if (!target) {
          showSendTokenSubMenu();
          return;
        }
        rl.question(chalk.white("请输入代币数量 (STT，回车取消): "), async (tokenAmt) => {
          if (!tokenAmt) {
            await showSendTokenSubMenu();
            return;
          }
          let amt = parseFloat(tokenAmt);
          if (isNaN(amt)) {
            addLog("代币数量必须是数字。");
            await showSendTokenSubMenu();
            return;
          }
          autoSendRunning = true;
          autoSendCancelled = false;
          await autoSendTokenChosen(target, tokenAmt);
          autoSendRunning = false;
          await showSendTokenSubMenu();
        });
      });
    } else if (choice === "3" && autoSendRunning) {
      autoSendCancelled = true;
      addLog("已接收停止交易命令 (自动发送)。");
      await showSendTokenSubMenu();
    } else if ((!autoSendRunning && choice === "3") || (autoSendRunning && choice === "4")) {
      await showMainMenu();
    } else if ((!autoSendRunning && choice === "4") || (autoSendRunning && choice === "5")) {
      console.log(chalk.red("退出程序"));
      process.exit(0);
    } else {
      addLog("无效选项");
      await showSendTokenSubMenu();
    }
  });
}

// 启动
async function start() {
  console.log(chalk.bold.green("=================== SOMNIA AUTO SWAP ==================="));
  console.log(chalk.yellow("关注X：https://x.com/qklxsqf 获得更多资讯"));
  console.log(chalk.green("======================================================="));
  await updateWalletData();
  await showMainMenu();
}

start();
