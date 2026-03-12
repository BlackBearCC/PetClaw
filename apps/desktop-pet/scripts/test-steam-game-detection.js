/**
 * test-steam-game-detection.js — Steam 游戏检测功能测试脚本
 * 
 * 用法: node scripts/test-steam-game-detection.js
 * 
 * 测试内容：
 * 1. 检查 greenworks 是否安装
 * 2. 检查 Win32Monitor 是否可用
 * 3. 测试游戏进程检测
 */

const path = require('path');
const { Win32Monitor } = require('../electron/win32-monitor');

// 游戏进程映射表（从 steam-service.js 复制）
const GAME_PROCESS_MAP = {
  'cs2.exe': { appId: 730, name: 'Counter-Strike 2' },
  'csgo.exe': { appId: 730, name: 'Counter-Strike: Global Offensive' },
  'valorant.exe': { appId: 1086940, name: 'VALORANT' },
  'overwatch2.exe': { appId: 2357570, name: 'Overwatch 2' },
  'apexlegends.exe': { appId: 1172470, name: 'Apex Legends' },
  'fortnite.exe': { appId: 1228930, name: 'Fortnite' },
  'pubg.exe': { appId: 578080, name: 'PUBG: BATTLEGROUNDS' },
  'dota2.exe': { appId: 570, name: 'Dota 2' },
  'minecraft.exe': { appId: 271870, name: 'Minecraft' },
  'terraria.exe': { appId: 1281930, name: 'Terraria' },
  'stardew valley.exe': { appId: 413150, name: 'Stardew Valley' },
  'gta5.exe': { appId: 271590, name: 'Grand Theft Auto V' },
  'rocketleague.exe': { appId: 252490, name: 'Rocket League' },
};

async function test() {
  console.log('========================================');
  console.log('🧪 Steam 游戏检测功能测试');
  console.log('========================================\n');

  // 1. 检查 greenworks
  console.log('📦 检查 greenworks 安装状态:');
  try {
    const greenworks = require('greenworks');
    console.log('   ✅ greenworks 已安装');
    console.log('   - 版本:', greenworks.version || 'unknown');
    console.log('   - Steam 运行中:', greenworks.isSteamRunning());
  } catch (e) {
    console.log('   ⚠️ greenworks 未安装');
    console.log('   - 原因:', e.message);
    console.log('   - 解决方案: npm install greenworks');
  }
  console.log('');

  // 2. 检查 Win32Monitor
  console.log('🖥️  检查 Win32 监控:');
  const win32Monitor = new Win32Monitor();
  if (win32Monitor.available) {
    console.log('   ✅ Win32 监控可用');
  } else {
    console.log('   ❌ Win32 监控不可用（koffi 未安装或加载失败）');
  }
  console.log('');

  // 3. 测试获取前台窗口
  console.log('🔍 测试获取前台窗口:');
  const foregroundInfo = win32Monitor.getForegroundInfo();
  if (foregroundInfo) {
    console.log('   - 进程名:', foregroundInfo.processName);
    console.log('   - 窗口标题:', foregroundInfo.title?.substring(0, 80) || '(无标题)');
    console.log('   - 分类:', foregroundInfo.category);
    
    // 4. 检测是否为游戏
    const processName = (foregroundInfo.processName || '').toLowerCase();
    console.log('');
    console.log('🎮 检测游戏:');
    
    let detected = null;
    for (const [proc, gameInfo] of Object.entries(GAME_PROCESS_MAP)) {
      if (processName === proc || processName.endsWith(proc)) {
        detected = gameInfo;
        break;
      }
    }
    
    if (detected) {
      console.log('   ✅ 检测到游戏:', detected.name, `(AppID: ${detected.appId})`);
    } else {
      console.log('   ℹ️ 当前前台窗口不是已知的游戏进程');
      
      // 检测标题是否包含游戏关键词
      if (win32Monitor.isGameWindow(foregroundInfo.title)) {
        console.log('   ℹ️ 但窗口标题可能包含游戏关键词');
      }
    }
  } else {
    console.log('   ❌ 无法获取前台窗口信息');
  }

  console.log('');
  console.log('========================================');
  console.log('✅ 测试完成');
  console.log('========================================\n');
  
  // 显示支持的游戏列表
  console.log('📋 支持检测的游戏列表:');
  for (const [proc, info] of Object.entries(GAME_PROCESS_MAP)) {
    console.log(`   - ${proc} → ${info.name}`);
  }
}

test().catch(console.error);