const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const livesElement = document.getElementById('lives');
const gameOverElement = document.getElementById('gameOver');
const finalScoreElement = document.getElementById('finalScore');
const restartBtn = document.getElementById('restartBtn');
const musicToggleBtn = document.getElementById('musicToggle');
const saveScoreBtn = document.getElementById('saveScoreBtn');
const playerNameInput = document.getElementById('playerName');
const saveScoreSection = document.getElementById('saveScoreSection');
const leaderboardList = document.getElementById('leaderboardList');

canvas.width = 600;
canvas.height = 800;

let score = 0;
let lives = 3;
let gameRunning = true;
let keys = {};

// ============ 音效系统 - Web Audio API 合成 ============
let audioCtx = null;
let soundEnabled = true;

function initAudio() {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            soundEnabled = false;
        }
    }
    // 浏览器策略: 需要用户交互后才能恢复播放
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// 射击音效 - 短促高频"piu"
function playShootSound() {
    if (!soundEnabled || !audioCtx) return;
    const now = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.1);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.1);
}

// 爆炸音效 - 低频噪音爆破
function playExplosionSound(size = 'normal') {
    if (!soundEnabled || !audioCtx) return;
    const now = audioCtx.currentTime;

    const duration = size === 'big' ? 0.4 : 0.2;
    const bufferSize = Math.floor(audioCtx.sampleRate * duration);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);

    // 生成衰减白噪音
    for (let i = 0; i < bufferSize; i++) {
        const t = i / bufferSize;
        // 低频偏向 + 噪音
        const noise = (Math.random() * 2 - 1);
        const rumble = Math.sin(2 * Math.PI * 80 * (i / audioCtx.sampleRate));
        data[i] = (noise * 0.7 + rumble * 0.3) * Math.pow(1 - t, 2);
    }

    const noiseSource = audioCtx.createBufferSource();
    noiseSource.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(size === 'big' ? 800 : 1200, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + duration);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(size === 'big' ? 0.4 : 0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    noiseSource.start(now);
    noiseSource.stop(now + duration);
}

// ============ 背景音乐 - Web Audio API 循环旋律 ============
let musicEnabled = true;
let musicStarted = false;     // 防止重复启动背景音乐
let musicNodes = null;        // 保存音乐节点引用,便于停止
let musicSchedulerId = null;  // 定时器 ID
let musicBeatIndex = 0;       // 当前节拍

// 主旋律(简谱: do re mi fa sol la si, 用频率表示)
// 一段轻快的太空战斗旋律
const MELODY = [
    // [频率, 持续拍数]
    [523.25, 1], [659.25, 1], [783.99, 1], [1046.50, 1],  // C5 E5 G5 C6 上行
    [987.77, 1],  [880.00, 1], [783.99, 1], [659.25, 1],   // B5 A5 G5 E5 下行
    [587.33, 1],  [698.46, 1], [880.00, 1], [1046.50, 1],  // D5 F5 A5 C6
    [1174.66, 2], [1046.50, 1], [880.00, 1],                // D6(2拍) C6 A5
    [783.99, 1],  [659.25, 1], [523.25, 2],                 // G5 E5 C5(2拍)
    [0, 1]                                                   // 休止
];

// 低音伴奏(每小节根音)
const BASS_LINE = [
    130.81,  // C3
    196.00,  // G3
    146.83,  // D3
    174.61,  // F3
    130.81,  // C3
    196.00   // G3
];

function startBackgroundMusic() {
    if (!soundEnabled || !audioCtx || !musicEnabled) return;
    stopBackgroundMusic();  // 先清理已有实例

    const tempo = 0.32;  // 每拍秒数(约 187 BPM,紧凑战斗感)
    let nextNoteTime = audioCtx.currentTime + 0.1;
    musicBeatIndex = 0;

    // 主增益(音量较低,不干扰音效)
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.12;
    masterGain.connect(audioCtx.destination);
    musicNodes = { masterGain };

    // 调度器: 提前安排音符
    function scheduleNote() {
        if (!musicEnabled || !audioCtx) return;
        const lookahead = 0.3;  // 提前 0.3s 安排

        while (nextNoteTime < audioCtx.currentTime + lookahead) {
            const [freq, beats] = MELODY[musicBeatIndex % MELODY.length];
            const duration = beats * tempo;

            // 主旋律(三角波,柔和)
            if (freq > 0) {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0, nextNoteTime);
                gain.gain.linearRampToValueAtTime(0.7, nextNoteTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, nextNoteTime + duration * 0.9);
                osc.connect(gain);
                gain.connect(masterGain);
                osc.start(nextNoteTime);
                osc.stop(nextNoteTime + duration);
            }

            // 低音伴奏(每 4 拍换一次根音)
            const bassIdx = Math.floor(musicBeatIndex / 4) % BASS_LINE.length;
            if (musicBeatIndex % 4 === 0) {
                const bassFreq = BASS_LINE[bassIdx];
                const bassOsc = audioCtx.createOscillator();
                const bassGain = audioCtx.createGain();
                bassOsc.type = 'sawtooth';
                bassOsc.frequency.value = bassFreq;
                const bassFilter = audioCtx.createBiquadFilter();
                bassFilter.type = 'lowpass';
                bassFilter.frequency.value = 400;
                bassGain.gain.setValueAtTime(0, nextNoteTime);
                bassGain.gain.linearRampToValueAtTime(0.35, nextNoteTime + 0.05);
                bassGain.gain.exponentialRampToValueAtTime(0.001, nextNoteTime + tempo * 4 * 0.95);
                bassOsc.connect(bassFilter);
                bassFilter.connect(bassGain);
                bassGain.connect(masterGain);
                bassOsc.start(nextNoteTime);
                bassOsc.stop(nextNoteTime + tempo * 4);
            }

            nextNoteTime += duration;
            musicBeatIndex++;
        }

        musicSchedulerId = setTimeout(scheduleNote, 100);
    }

    scheduleNote();
}

function stopBackgroundMusic() {
    if (musicSchedulerId) {
        clearTimeout(musicSchedulerId);
        musicSchedulerId = null;
    }
    if (musicNodes && musicNodes.masterGain && audioCtx) {
        // 平滑淡出
        try {
            musicNodes.masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
            musicNodes.masterGain.gain.setValueAtTime(musicNodes.masterGain.gain.value, audioCtx.currentTime);
            musicNodes.masterGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.3);
        } catch (e) { /* 忽略 */ }
    }
    musicNodes = null;
}

function toggleMusic() {
    initAudio();  // 确保音频上下文已初始化(点击也是有效交互)
    musicEnabled = !musicEnabled;
    if (musicEnabled) {
        musicToggleBtn.textContent = '♪ 开';
        musicToggleBtn.classList.remove('muted');
        if (gameRunning) {
            musicStarted = true;
            startBackgroundMusic();
        }
    } else {
        musicToggleBtn.textContent = '♪ 关';
        musicToggleBtn.classList.add('muted');
        stopBackgroundMusic();
    }
}

// ============ 排行榜系统 - localStorage 持久化 ============
const LEADERBOARD_KEY = 'flys_leaderboard_v1';
const MAX_LEADERBOARD_SIZE = 10;

function loadLeaderboard() {
    try {
        const data = localStorage.getItem(LEADERBOARD_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        return [];
    }
}

function saveLeaderboard(list) {
    try {
        localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(list));
    } catch (e) { /* localStorage 不可用时静默 */ }
}

// 判断分数是否能进榜
function qualifiesForLeaderboard(scoreValue) {
    const list = loadLeaderboard();
    if (list.length < MAX_LEADERBOARD_SIZE) return true;
    return scoreValue > (list[list.length - 1]?.score || 0);
}

// 保存分数到排行榜,返回新条目在列表中的索引(未入榜返回 -1)
function addScoreToLeaderboard(name, scoreValue) {
    const list = loadLeaderboard();
    const entry = {
        name: name || '匿名',
        score: scoreValue,
        date: new Date().toLocaleDateString('zh-CN')
    };
    list.push(entry);
    // 降序排序
    list.sort((a, b) => b.score - a.score);
    // 截取前 10
    const trimmed = list.slice(0, MAX_LEADERBOARD_SIZE);
    saveLeaderboard(trimmed);
    // 找到新条目位置
    const newIndex = trimmed.findIndex(item =>
        item.name === entry.name && item.score === entry.score && item.date === entry.date
    );
    return newIndex;
}

// 渲染排行榜,newIndex 为新入榜条目索引(用于高亮)
function renderLeaderboard(newIndex = -1) {
    const list = loadLeaderboard();
    leaderboardList.innerHTML = '';

    if (list.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'empty-tip';
        empty.textContent = '暂无记录,成为第一名!';
        leaderboardList.appendChild(empty);
        return;
    }

    list.forEach((item, idx) => {
        const li = document.createElement('li');
        if (idx === newIndex) li.className = 'new-entry';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'player-name';
        nameSpan.textContent = item.name;

        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'player-score';
        scoreSpan.textContent = item.score;

        li.appendChild(nameSpan);
        li.appendChild(scoreSpan);
        leaderboardList.appendChild(li);
    });
}

function handleSaveScore() {
    const name = playerNameInput.value.trim() || '匿名';
    const newIndex = addScoreToLeaderboard(name, score);
    renderLeaderboard(newIndex);
    // 已保存,禁用按钮并清空输入
    saveScoreBtn.disabled = true;
    saveScoreBtn.textContent = '已保存';
    playerNameInput.disabled = true;
}

// 玩家战机 - 更详细的设计
const player = {
    x: canvas.width / 2 - 25,
    y: canvas.height - 80,
    width: 50,
    height: 60,
    speed: 7,
    color: '#4ecdc4',
    invincible: 0,        // 无敌帧
    thrusterPhase: 0      // 尾焰动画相位
};

let bullets = [];
let enemies = [];
let enemyBullets = [];   // 敌人子弹
let powerUps = [];       // 生命补给包
let particles = [];      // 爆炸粒子
let enemySpawnRate = 60;
let powerUpSpawnRate = 600;  // 生命包刷新间隔(帧)
let frameCount = 0;

// 敌人类型定义 - 攻击力多变
const ENEMY_TYPES = [
    {
        // 侦察机 - 小快,低伤害
        name: 'scout',
        size: 35,
        speed: 3.5,
        hp: 1,
        damage: 1,
        score: 10,
        color: '#ff6b6b',
        canShoot: false,
        shootRate: 0
    },
    {
        // 战斗机 - 中等,会射击
        name: 'fighter',
        size: 45,
        speed: 2.5,
        hp: 2,
        damage: 1,
        score: 25,
        color: '#ffa502',
        canShoot: true,
        shootRate: 120
    },
    {
        // 轰炸机 - 大慢,高伤害
        name: 'bomber',
        size: 60,
        speed: 1.5,
        hp: 4,
        damage: 2,
        score: 50,
        color: '#a55eea',
        canShoot: true,
        shootRate: 90
    },
    {
        // 精英机 - 高威胁
        name: 'elite',
        size: 50,
        speed: 3,
        hp: 3,
        damage: 3,
        score: 75,
        color: '#ff4757',
        canShoot: true,
        shootRate: 70
    }
];

document.addEventListener('keydown', (e) => {
    initAudio();  // 用户首次按键后激活音频上下文
    // 首次交互且音乐开启时启动背景音乐
    if (!musicStarted && musicEnabled && gameRunning) {
        musicStarted = true;
        startBackgroundMusic();
    }
    keys[e.key] = true;
    if (e.key === ' ') {
        e.preventDefault();
        shoot();
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.key] = false;
});

restartBtn.addEventListener('click', restartGame);
musicToggleBtn.addEventListener('click', toggleMusic);
saveScoreBtn.addEventListener('click', handleSaveScore);
playerNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !saveScoreBtn.disabled) {
        handleSaveScore();
    }
    e.stopPropagation();  // 防止触发玩家移动
});

// ============ 玩家战机绘制 - 逼真战斗机 ============
function drawPlayer() {
    const cx = player.x + player.width / 2;
    const cy = player.y + player.height / 2;
    
    // 无敌闪烁
    if (player.invincible > 0 && Math.floor(player.invincible / 5) % 2 === 0) {
        return;
    }
    
    // 尾焰动画
    player.thrusterPhase += 0.3;
    const flameLen = 12 + Math.sin(player.thrusterPhase) * 4;
    
    // 主尾焰
    const flameGrad = ctx.createLinearGradient(cx, player.y + player.height, cx, player.y + player.height + flameLen);
    flameGrad.addColorStop(0, '#ffd700');
    flameGrad.addColorStop(0.5, '#ff6b35');
    flameGrad.addColorStop(1, 'rgba(255, 0, 0, 0)');
    ctx.fillStyle = flameGrad;
    ctx.beginPath();
    ctx.moveTo(cx - 8, player.y + player.height - 5);
    ctx.lineTo(cx + 8, player.y + player.height - 5);
    ctx.lineTo(cx + 4, player.y + player.height + flameLen);
    ctx.lineTo(cx - 4, player.y + player.height + flameLen);
    ctx.closePath();
    ctx.fill();
    
    // 侧翼尾焰
    ctx.fillStyle = 'rgba(255, 165, 0, 0.6)';
    ctx.beginPath();
    ctx.moveTo(player.x + 5, player.y + player.height - 10);
    ctx.lineTo(player.x + 12, player.y + player.height - 10);
    ctx.lineTo(player.x + 8, player.y + player.height + flameLen * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(player.x + player.width - 12, player.y + player.height - 10);
    ctx.lineTo(player.x + player.width - 5, player.y + player.height - 10);
    ctx.lineTo(player.x + player.width - 8, player.y + player.height + flameLen * 0.6);
    ctx.closePath();
    ctx.fill();
    
    // 机身阴影
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(cx + 2, player.y + player.height + 5, 20, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // 机翼(左右)
    const wingGrad = ctx.createLinearGradient(player.x, cy, player.x + player.width, cy);
    wingGrad.addColorStop(0, '#2a9d8f');
    wingGrad.addColorStop(0.5, '#4ecdc4');
    wingGrad.addColorStop(1, '#2a9d8f');
    ctx.fillStyle = wingGrad;
    
    // 左机翼
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 5);
    ctx.lineTo(player.x - 3, cy + 15);
    ctx.lineTo(player.x + 5, cy + 20);
    ctx.lineTo(cx - 5, cy + 15);
    ctx.closePath();
    ctx.fill();
    
    // 右机翼
    ctx.beginPath();
    ctx.moveTo(cx + 5, cy - 5);
    ctx.lineTo(player.x + player.width + 3, cy + 15);
    ctx.lineTo(player.x + player.width - 5, cy + 20);
    ctx.lineTo(cx + 5, cy + 15);
    ctx.closePath();
    ctx.fill();
    
    // 主机身
    const bodyGrad = ctx.createLinearGradient(cx - 8, 0, cx + 8, 0);
    bodyGrad.addColorStop(0, '#2a9d8f');
    bodyGrad.addColorStop(0.5, '#7fe5dc');
    bodyGrad.addColorStop(1, '#2a9d8f');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(cx, player.y);
    ctx.lineTo(cx + 10, player.y + 30);
    ctx.lineTo(cx + 8, player.y + player.height - 5);
    ctx.lineTo(cx - 8, player.y + player.height - 5);
    ctx.lineTo(cx - 10, player.y + 30);
    ctx.closePath();
    ctx.fill();
    
    // 机鼻
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.moveTo(cx, player.y);
    ctx.lineTo(cx + 3, player.y + 8);
    ctx.lineTo(cx - 3, player.y + 8);
    ctx.closePath();
    ctx.fill();
    
    // 座舱(玻璃罩)
    const cockpitGrad = ctx.createRadialGradient(cx, cy + 5, 1, cx, cy + 5, 10);
    cockpitGrad.addColorStop(0, '#a8dadc');
    cockpitGrad.addColorStop(0.7, '#457b9d');
    cockpitGrad.addColorStop(1, '#1d3557');
    ctx.fillStyle = cockpitGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 5, 7, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // 座舱高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.ellipse(cx - 2, cy, 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // 机翼武器挂载
    ctx.fillStyle = '#444';
    ctx.fillRect(player.x + 2, cy + 5, 3, 10);
    ctx.fillRect(player.x + player.width - 5, cy + 5, 3, 10);
}

function updatePlayer() {
    if (keys['ArrowLeft'] || keys['a']) {
        player.x -= player.speed;
    }
    if (keys['ArrowRight'] || keys['d']) {
        player.x += player.speed;
    }
    if (keys['ArrowUp'] || keys['w']) {
        player.y -= player.speed;
    }
    if (keys['ArrowDown'] || keys['s']) {
        player.y += player.speed;
    }
    
    player.x = Math.max(0, Math.min(canvas.width - player.width, player.x));
    player.y = Math.max(0, Math.min(canvas.height - player.height, player.y));
    
    if (player.invincible > 0) player.invincible--;
}

function shoot() {
    if (!gameRunning) return;

    // 双管齐射
    bullets.push({
        x: player.x + 8,
        y: player.y + 20,
        width: 4,
        height: 14,
        speed: 12,
        color: '#ffeaa7'
    });
    bullets.push({
        x: player.x + player.width - 12,
        y: player.y + 20,
        width: 4,
        height: 14,
        speed: 12,
        color: '#ffeaa7'
    });

    playShootSound();
}

// ============ 子弹绘制 - 能量光弹 ============
function drawBullets() {
    bullets.forEach(bullet => {
        // 外发光
        const glowGrad = ctx.createRadialGradient(
            bullet.x + bullet.width / 2, bullet.y + bullet.height / 2, 0,
            bullet.x + bullet.width / 2, bullet.y + bullet.height / 2, 10
        );
        glowGrad.addColorStop(0, 'rgba(255, 234, 167, 0.8)');
        glowGrad.addColorStop(1, 'rgba(255, 234, 167, 0)');
        ctx.fillStyle = glowGrad;
        ctx.fillRect(bullet.x - 8, bullet.y - 8, bullet.width + 16, bullet.height + 16);
        
        // 核心
        ctx.fillStyle = bullet.color;
        ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
        
        // 高光
        ctx.fillStyle = '#fff';
        ctx.fillRect(bullet.x + 1, bullet.y + 1, 1, bullet.height - 2);
    });
}

function updateBullets() {
    bullets = bullets.filter(bullet => {
        bullet.y -= bullet.speed;
        return bullet.y > -bullet.height;
    });
}

// ============ 敌人创建 - 不同类型 ============
function createEnemy() {
    // 根据分数解锁更强敌人
    let availableTypes = [ENEMY_TYPES[0]]; // scout 始终可用
    if (score >= 50) availableTypes.push(ENEMY_TYPES[1]);  // fighter
    if (score >= 200) availableTypes.push(ENEMY_TYPES[2]); // bomber
    if (score >= 500) availableTypes.push(ENEMY_TYPES[3]); // elite
    
    const type = availableTypes[Math.floor(Math.random() * availableTypes.length)];
    const size = type.size;
    
    const startX = Math.random() * (canvas.width - size);
    enemies.push({
        x: startX,
        y: -size,
        width: size,
        height: size,
        speed: type.speed,
        color: type.color,
        hp: type.hp,
        maxHp: type.hp,
        damage: type.damage,
        scoreValue: type.score,
        type: type.name,
        canShoot: type.canShoot,
        shootRate: type.shootRate,
        shootTimer: Math.random() * type.shootRate,
        wobble: Math.random() * Math.PI * 2,
        rotation: 0,
        baseX: startX,                    // 初始 X 用于正弦摆动
        driftPhase: Math.random() * Math.PI * 2,  // 横向漂移相位
        wingFlap: 0,                       // 机翼振动相位
        enginePulse: 0,                    // 引擎脉冲
        eyeBlink: Math.random() * 200,     // 眨眼计时
        energyPhase: Math.random() * Math.PI * 2  // 能量脉冲
    });
}

// ============ 敌人绘制 - 形象化设计 ============
function drawEnemies() {
    enemies.forEach(enemy => {
        const cx = enemy.x + enemy.width / 2;
        const cy = enemy.y + enemy.height / 2;
        
        // 阴影
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(cx, enemy.y + enemy.height + 3, enemy.width / 3, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        
        if (enemy.type === 'scout') {
            drawScout(enemy, cx, cy);
        } else if (enemy.type === 'fighter') {
            drawFighter(enemy, cx, cy);
        } else if (enemy.type === 'bomber') {
            drawBomber(enemy, cx, cy);
        } else if (enemy.type === 'elite') {
            drawElite(enemy, cx, cy);
        }
        
        // 血量条
        if (enemy.hp < enemy.maxHp) {
            const barWidth = enemy.width;
            const barX = enemy.x;
            const barY = enemy.y - 8;
            ctx.fillStyle = '#333';
            ctx.fillRect(barX, barY, barWidth, 4);
            ctx.fillStyle = enemy.hp / enemy.maxHp > 0.5 ? '#2ecc71' : 
                           enemy.hp / enemy.maxHp > 0.25 ? '#f39c12' : '#e74c3c';
            ctx.fillRect(barX, barY, barWidth * (enemy.hp / enemy.maxHp), 4);
        }
    });
}

// 侦察机 - 红色小型战机,蛇形俯冲
function drawScout(enemy, cx, cy) {
    enemy.rotation += 0.02;
    
    // 飞行倾斜(基于横向速度)
    const driftVel = Math.cos(enemy.driftPhase) * 40 * 0.03; // 摆动速度
    const tilt = Math.max(-0.4, Math.min(0.4, driftVel * 0.5));
    
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    
    // 引擎尾焰(上方,因敌机向下飞)
    const flameLen = 8 + Math.sin(enemy.enginePulse) * 3;
    const flameGrad = ctx.createLinearGradient(0, -enemy.height / 2, 0, -enemy.height / 2 - flameLen);
    flameGrad.addColorStop(0, '#fff200');
    flameGrad.addColorStop(0.5, '#ff6b35');
    flameGrad.addColorStop(1, 'rgba(255, 0, 0, 0)');
    ctx.fillStyle = flameGrad;
    ctx.beginPath();
    ctx.moveTo(-4, -enemy.height / 2 + 2);
    ctx.lineTo(4, -enemy.height / 2 + 2);
    ctx.lineTo(2, -enemy.height / 2 - flameLen);
    ctx.lineTo(-2, -enemy.height / 2 - flameLen);
    ctx.closePath();
    ctx.fill();
    
    // 外发光
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, enemy.width);
    glow.addColorStop(0, 'rgba(255, 107, 107, 0.4)');
    glow.addColorStop(1, 'rgba(255, 107, 107, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-enemy.width, -enemy.height, enemy.width * 2, enemy.height * 2);
    
    // 振动的机翼(左右)
    const flap = Math.sin(enemy.wingFlap) * 3;
    ctx.fillStyle = '#a93226';
    // 左翼
    ctx.beginPath();
    ctx.moveTo(-4, -5);
    ctx.lineTo(-enemy.width / 2 - 2, 0 + flap);
    ctx.lineTo(-enemy.width / 2 + 5, 10);
    ctx.lineTo(-4, 8);
    ctx.closePath();
    ctx.fill();
    // 右翼
    ctx.beginPath();
    ctx.moveTo(4, -5);
    ctx.lineTo(enemy.width / 2 + 2, 0 - flap);
    ctx.lineTo(enemy.width / 2 - 5, 10);
    ctx.lineTo(4, 8);
    ctx.closePath();
    ctx.fill();
    
    // 机身(倒三角带弧度)
    const grad = ctx.createLinearGradient(0, -enemy.height / 2, 0, enemy.height / 2);
    grad.addColorStop(0, '#ff4757');
    grad.addColorStop(0.5, '#e84118');
    grad.addColorStop(1, '#c0392b');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, enemy.height / 2);
    ctx.quadraticCurveTo(enemy.width / 2 - 2, 0, enemy.width / 2 - 6, -enemy.height / 2 + 3);
    ctx.quadraticCurveTo(0, -enemy.height / 2 + 8, -enemy.width / 2 + 6, -enemy.height / 2 + 3);
    ctx.quadraticCurveTo(-enemy.width / 2 + 2, 0, 0, enemy.height / 2);
    ctx.closePath();
    ctx.fill();
    
    // 机身中线高光
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -enemy.height / 2 + 5);
    ctx.lineTo(0, enemy.height / 2 - 3);
    ctx.stroke();
    
    // 驾驶舱(带眨眼)
    const blink = (enemy.eyeBlink % 180) < 8; // 偶尔眨眼
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(0, 2, 5, blink ? 1 : 4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!blink) {
        ctx.fillStyle = '#2c3e50';
        ctx.beginPath();
        ctx.arc(0, 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
        // 瞳孔高光
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-1, 1, 1, 0, Math.PI * 2);
        ctx.fill();
    }
    
    ctx.restore();
}

// 战斗机 - 橙色重型战机,带双引擎
function drawFighter(enemy, cx, cy) {
    enemy.wobble += 0.05;
    
    // 飞行倾斜(摆动方向决定)
    const driftVel = Math.cos(enemy.driftPhase) * 25 * 0.03;
    const tilt = Math.max(-0.3, Math.min(0.3, driftVel * 0.6));
    const flap = Math.sin(enemy.wingFlap) * 2;
    
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    
    // 双引擎尾焰
    const flameLen = 10 + Math.sin(enemy.enginePulse) * 4;
    [-8, 8].forEach(offset => {
        const flameGrad = ctx.createLinearGradient(offset, -enemy.height / 2, offset, -enemy.height / 2 - flameLen);
        flameGrad.addColorStop(0, '#fff200');
        flameGrad.addColorStop(0.4, '#ff8c00');
        flameGrad.addColorStop(1, 'rgba(255, 0, 0, 0)');
        ctx.fillStyle = flameGrad;
        ctx.beginPath();
        ctx.moveTo(offset - 3, -enemy.height / 2 + 5);
        ctx.lineTo(offset + 3, -enemy.height / 2 + 5);
        ctx.lineTo(offset + 1, -enemy.height / 2 - flameLen);
        ctx.lineTo(offset - 1, -enemy.height / 2 - flameLen);
        ctx.closePath();
        ctx.fill();
    });
    
    // 主机翼(后掠翼,带振动)
    ctx.fillStyle = '#d35400';
    // 左翼
    ctx.beginPath();
    ctx.moveTo(-6, -3);
    ctx.lineTo(-enemy.width / 2 - 3, 8 + flap);
    ctx.lineTo(-enemy.width / 2 + 10, 18);
    ctx.lineTo(-6, 12);
    ctx.closePath();
    ctx.fill();
    // 右翼
    ctx.beginPath();
    ctx.moveTo(6, -3);
    ctx.lineTo(enemy.width / 2 + 3, 8 - flap);
    ctx.lineTo(enemy.width / 2 - 10, 18);
    ctx.lineTo(6, 12);
    ctx.closePath();
    ctx.fill();
    
    // 翼尖红灯
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(-enemy.width / 2 - 1, 8 + flap, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(enemy.width / 2 + 1, 8 - flap, 1.5, 0, Math.PI * 2);
    ctx.fill();
    
    // 主机身(菱形带弧度)
    const grad = ctx.createLinearGradient(-10, 0, 10, 0);
    grad.addColorStop(0, '#d35400');
    grad.addColorStop(0.3, '#e67e22');
    grad.addColorStop(0.5, '#ffa502');
    grad.addColorStop(0.7, '#e67e22');
    grad.addColorStop(1, '#d35400');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -enemy.height / 2);
    ctx.quadraticCurveTo(12, -5, 10, 10);
    ctx.quadraticCurveTo(8, enemy.height / 2, 0, enemy.height / 2);
    ctx.quadraticCurveTo(-8, enemy.height / 2, -10, 10);
    ctx.quadraticCurveTo(-12, -5, 0, -enemy.height / 2);
    ctx.closePath();
    ctx.fill();
    
    // 进气口
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.ellipse(-7, 5, 2, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(7, 5, 2, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // 机身中线
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -enemy.height / 2 + 3);
    ctx.lineTo(0, enemy.height / 2 - 3);
    ctx.stroke();
    
    // 驾驶舱(玻璃罩,带高光)
    const cockpitGrad = ctx.createRadialGradient(-1, -7, 1, 0, -5, 8);
    cockpitGrad.addColorStop(0, '#a4b0be');
    cockpitGrad.addColorStop(0.6, '#34495e');
    cockpitGrad.addColorStop(1, '#1e272e');
    ctx.fillStyle = cockpitGrad;
    ctx.beginPath();
    ctx.ellipse(0, -5, 5, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    // 高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.beginPath();
    ctx.ellipse(-2, -8, 1.5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // 尾翼(垂直)
    ctx.fillStyle = '#a04000';
    ctx.beginPath();
    ctx.moveTo(0, enemy.height / 2 - 8);
    ctx.lineTo(-3, enemy.height / 2 + 2);
    ctx.lineTo(3, enemy.height / 2 + 2);
    ctx.closePath();
    ctx.fill();
    
    ctx.restore();
}

// 轰炸机 - 紫色 UFO,带能量场和机械触手
function drawBomber(enemy, cx, cy) {
    enemy.rotation += 0.015;
    const pulse = 1 + Math.sin(enemy.enginePulse) * 0.1;
    const energyIntensity = 0.4 + Math.sin(enemy.energyPhase) * 0.3;
    
    // 能量场(外层脉冲圈)
    for (let i = 0; i < 2; i++) {
        const r = enemy.width / 2 + 8 + i * 6 + Math.sin(enemy.energyPhase + i) * 4;
        ctx.strokeStyle = `rgba(165, 94, 234, ${0.3 - i * 0.1})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    }
    
    // 外发光
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, enemy.width);
    glow.addColorStop(0, `rgba(165, 94, 234, ${energyIntensity})`);
    glow.addColorStop(1, 'rgba(165, 94, 234, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - enemy.width, cy - enemy.height, enemy.width * 2, enemy.height * 2);
    
    // 旋转的机械触手(4根)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(enemy.rotation);
    for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate((Math.PI / 2) * i);
        ctx.strokeStyle = '#6c3483';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, enemy.width / 2 - 3);
        const wiggle = Math.sin(enemy.energyPhase + i) * 3;
        ctx.quadraticCurveTo(wiggle, enemy.width / 2 + 5, 0, enemy.width / 2 + 10);
        ctx.stroke();
        // 触手末端球
        ctx.fillStyle = '#8e44ad';
        ctx.beginPath();
        ctx.arc(0, enemy.width / 2 + 10, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.restore();
    
    // 旋转环(带断点)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(enemy.rotation);
    ctx.strokeStyle = '#8e44ad';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
        const startAngle = (Math.PI * 2 / 3) * i;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.width / 2 + 2, startAngle, startAngle + Math.PI / 4);
        ctx.stroke();
    }
    ctx.restore();
    
    // 反向旋转的小点
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-enemy.rotation * 1.5);
    ctx.fillStyle = '#c39bd3';
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * (enemy.width / 2 - 4), Math.sin(a) * (enemy.width / 2 - 4), 1.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
    
    // 主机体(UFO 碟形)
    const grad = ctx.createRadialGradient(cx - 8, cy - 8, 2, cx, cy, enemy.width / 2);
    grad.addColorStop(0, '#d2b4de');
    grad.addColorStop(0.4, '#a55eea');
    grad.addColorStop(0.8, '#6c3483');
    grad.addColorStop(1, '#4a235a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, enemy.width / 2 - 2, enemy.height / 3, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // 装甲条纹
    ctx.strokeStyle = '#4a235a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - enemy.width / 3, cy);
    ctx.lineTo(cx + enemy.width / 3, cy);
    ctx.stroke();
    
    // 上方圆顶(玻璃罩)
    const domeGrad = ctx.createRadialGradient(cx - 3, cy - 8, 1, cx, cy - 5, 12);
    domeGrad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
    domeGrad.addColorStop(0.5, 'rgba(165, 94, 234, 0.6)');
    domeGrad.addColorStop(1, 'rgba(74, 35, 90, 0.9)');
    ctx.fillStyle = domeGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 5, 10, 8, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    
    // 核心(独眼,带眨眼和脉冲)
    const blink = (enemy.eyeBlink % 220) < 8;
    const eyeR = (6 + Math.sin(enemy.energyPhase) * 1.5) * pulse;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, 7, blink ? 1 : eyeR, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!blink) {
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath();
        ctx.arc(cx, cy + 2, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx - 1, cy + 1, 1.5, 0, Math.PI * 2);
        ctx.fill();
        // 红色光束(瞄准)
        ctx.fillStyle = `rgba(255, 0, 0, ${0.3 + Math.sin(enemy.energyPhase) * 0.2})`;
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy + 2);
        ctx.lineTo(cx + 3, cy + 2);
        ctx.lineTo(cx + 8, cy + 30);
        ctx.lineTo(cx - 8, cy + 30);
        ctx.closePath();
        ctx.fill();
    }
}

// 精英机 - 红黑能量体,带尖刺和脉冲核心
function drawElite(enemy, cx, cy) {
    enemy.rotation += 0.05;
    const pulse = 1 + Math.sin(enemy.enginePulse) * 0.15;
    const energyIntensity = 0.5 + Math.sin(enemy.energyPhase) * 0.3;
    
    // 危险能量场(多层脉冲)
    for (let i = 0; i < 3; i++) {
        const r = enemy.width / 2 + 5 + i * 8 + Math.sin(enemy.energyPhase + i * 0.5) * 5;
        ctx.strokeStyle = `rgba(255, 71, 87, ${0.4 - i * 0.12})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    }
    
    // 中心发光
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, enemy.width);
    glow.addColorStop(0, `rgba(255, 71, 87, ${energyIntensity})`);
    glow.addColorStop(0.5, 'rgba(231, 76, 60, 0.3)');
    glow.addColorStop(1, 'rgba(255, 71, 87, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - enemy.width, cy - enemy.height, enemy.width * 2, enemy.height * 2);
    
    // 外圈尖刺(8根,旋转)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(enemy.rotation);
    for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4);
        const spikeLen = enemy.width / 2 + 5 + Math.sin(enemy.energyPhase + i) * 3;
        const spikeGrad = ctx.createLinearGradient(0, -enemy.width / 2, 0, -spikeLen);
        spikeGrad.addColorStop(0, '#c0392b');
        spikeGrad.addColorStop(0.7, '#e74c3c');
        spikeGrad.addColorStop(1, '#fff');
        ctx.fillStyle = spikeGrad;
        ctx.beginPath();
        ctx.moveTo(0, -enemy.width / 2);
        ctx.lineTo(4, -enemy.width / 2 + 5);
        ctx.lineTo(0, -spikeLen);
        ctx.lineTo(-4, -enemy.width / 2 + 5);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
    
    // 反向旋转的外环(带能量节点)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-enemy.rotation * 0.7);
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, enemy.width / 2 + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // 能量节点
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i;
        const r = enemy.width / 2 + 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 2, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
    
    // 中心六边形(反向旋转)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-enemy.rotation * 0.5);
    
    const hexR = (enemy.width / 3) * pulse;
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, hexR);
    grad.addColorStop(0, '#ff6b6b');
    grad.addColorStop(0.5, '#c0392b');
    grad.addColorStop(1, '#7f1d1d');
    ctx.fillStyle = grad;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const x = Math.cos(angle) * hexR;
        const y = Math.sin(angle) * hexR;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    
    // 六边形边框
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // 内部能量符文(三角形)
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 + Math.sin(enemy.energyPhase) * 0.3})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
        const a = (Math.PI * 2 / 3) * i - Math.PI / 2;
        const x = Math.cos(a) * hexR * 0.6;
        const y = Math.sin(a) * hexR * 0.6;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    
    // 中心眼(强脉冲)
    const blink = (enemy.eyeBlink % 150) < 6;
    const eyeR = (5 + Math.sin(enemy.energyPhase) * 2) * pulse;
    
    // 眼眶
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    
    if (!blink) {
        // 红色虹膜
        const irisGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, eyeR);
        irisGrad.addColorStop(0, '#ff0000');
        irisGrad.addColorStop(0.7, '#c0392b');
        irisGrad.addColorStop(1, '#7f1d1d');
        ctx.fillStyle = irisGrad;
        ctx.beginPath();
        ctx.arc(0, 0, eyeR, 0, Math.PI * 2);
        ctx.fill();
        
        // 黑色瞳孔
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(0, 0, 2, 0, Math.PI * 2);
        ctx.fill();
        
        // 高光
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-1, -1, 1, 0, Math.PI * 2);
        ctx.fill();
    }
    
    ctx.restore();
}

function updateEnemies() {
    enemies = enemies.filter(enemy => {
        enemy.y += enemy.speed;
        
        // 横向摆动飞行(不同类型摆动幅度不同)
        enemy.driftPhase += 0.03;
        let driftAmp = 0;
        if (enemy.type === 'scout') driftAmp = 40;      // 侦察机大幅蛇形
        else if (enemy.type === 'fighter') driftAmp = 25; // 战斗机中等摆动
        else if (enemy.type === 'bomber') driftAmp = 10;  // 轰炸机微摆
        else if (enemy.type === 'elite') driftAmp = 30;   // 精英机蛇形
        
        enemy.x = enemy.baseX + Math.sin(enemy.driftPhase) * driftAmp;
        enemy.x = Math.max(0, Math.min(canvas.width - enemy.width, enemy.x));
        
        // 更新动画相位
        enemy.wingFlap += 0.2;
        enemy.enginePulse += 0.15;
        enemy.energyPhase += 0.08;
        enemy.eyeBlink++;
        
        // 射击
        if (enemy.canShoot) {
            enemy.shootTimer++;
            if (enemy.shootTimer >= enemy.shootRate) {
                enemy.shootTimer = 0;
                enemyBullets.push({
                    x: enemy.x + enemy.width / 2 - 3,
                    y: enemy.y + enemy.height,
                    width: 6,
                    height: 12,
                    speed: 4 + enemy.speed,
                    color: enemy.color,
                    damage: enemy.damage
                });
            }
        }
        
        return enemy.y < canvas.height;
    });
}

// ============ 敌人子弹绘制 ============
function drawEnemyBullets() {
    enemyBullets.forEach(bullet => {
        // 发光
        const glow = ctx.createRadialGradient(
            bullet.x + bullet.width / 2, bullet.y + bullet.height / 2, 0,
            bullet.x + bullet.width / 2, bullet.y + bullet.height / 2, 8
        );
        glow.addColorStop(0, bullet.color);
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(bullet.x - 6, bullet.y - 6, bullet.width + 12, bullet.height + 12);
        ctx.globalAlpha = 1;
        
        // 核心
        ctx.fillStyle = bullet.color;
        ctx.beginPath();
        ctx.arc(bullet.x + bullet.width / 2, bullet.y + bullet.height / 2, bullet.width / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(bullet.x + bullet.width / 2, bullet.y + bullet.height / 2, 1, 0, Math.PI * 2);
        ctx.fill();
    });
}

function updateEnemyBullets() {
    enemyBullets = enemyBullets.filter(bullet => {
        bullet.y += bullet.speed;
        return bullet.y < canvas.height;
    });
}

// ============ 生命补给包 - 随机刷新 ============
function createPowerUp() {
    powerUps.push({
        x: Math.random() * (canvas.width - 30),
        y: -30,
        width: 30,
        height: 30,
        speed: 2,
        type: Math.random() < 0.7 ? 'life' : 'shield',  // 70%生命,30%护盾
        phase: 0
    });
}

function drawPowerUps() {
    powerUps.forEach(pu => {
        pu.phase += 0.1;
        const cx = pu.x + pu.width / 2;
        const cy = pu.y + pu.height / 2;
        const pulse = 1 + Math.sin(pu.phase) * 0.15;
        
        if (pu.type === 'life') {
            // 发光圈
            const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 25 * pulse);
            glow.addColorStop(0, 'rgba(46, 204, 113, 0.6)');
            glow.addColorStop(1, 'rgba(46, 204, 113, 0)');
            ctx.fillStyle = glow;
            ctx.fillRect(cx - 25, cy - 25, 50, 50);
            
            // 十字医疗包
            ctx.fillStyle = '#fff';
            ctx.fillRect(pu.x, pu.y, pu.width, pu.height);
            ctx.strokeStyle = '#27ae60';
            ctx.lineWidth = 2;
            ctx.strokeRect(pu.x, pu.y, pu.width, pu.height);
            
            // 红十字
            ctx.fillStyle = '#e74c3c';
            ctx.fillRect(cx - 2, pu.y + 7, 4, 16);
            ctx.fillRect(pu.x + 7, cy - 2, 16, 4);
        } else {
            // 护盾道具 - 蓝色
            const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 25 * pulse);
            glow.addColorStop(0, 'rgba(52, 152, 219, 0.6)');
            glow.addColorStop(1, 'rgba(52, 152, 219, 0)');
            ctx.fillStyle = glow;
            ctx.fillRect(cx - 25, cy - 25, 50, 50);
            
            // 盾牌形状
            ctx.fillStyle = '#3498db';
            ctx.beginPath();
            ctx.moveTo(cx, pu.y);
            ctx.lineTo(pu.x + pu.width, pu.y + 5);
            ctx.lineTo(pu.x + pu.width - 3, pu.y + 20);
            ctx.lineTo(cx, pu.y + pu.height);
            ctx.lineTo(pu.x + 3, pu.y + 20);
            ctx.lineTo(pu.x, pu.y + 5);
            ctx.closePath();
            ctx.fill();
            
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });
}

function updatePowerUps() {
    powerUps = powerUps.filter(pu => {
        pu.y += pu.speed;
        return pu.y < canvas.height;
    });
}

// ============ 爆炸粒子 ============
function createExplosion(x, y, color, count = 15) {
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
        const speed = 2 + Math.random() * 4;
        particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 2 + Math.random() * 3,
            life: 30 + Math.random() * 20,
            maxLife: 50,
            color: color
        });
    }
}

function drawParticles() {
    particles.forEach(p => {
        const alpha = p.life / p.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;
}

function updateParticles() {
    particles = particles.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.95;
        p.vy *= 0.95;
        p.life--;
        return p.life > 0;
    });
}

// ============ 碰撞检测 ============
function checkCollisions() {
    // 子弹击中敌人
    bullets.forEach((bullet, bulletIndex) => {
        enemies.forEach((enemy, enemyIndex) => {
            if (bullet.x < enemy.x + enemy.width &&
                bullet.x + bullet.width > enemy.x &&
                bullet.y < enemy.y + enemy.height &&
                bullet.y + bullet.height > enemy.y) {
                
                bullets.splice(bulletIndex, 1);
                enemy.hp--;
                
                // 小爆炸
                createExplosion(bullet.x, bullet.y, enemy.color, 5);
                
                if (enemy.hp <= 0) {
                    createExplosion(
                        enemy.x + enemy.width / 2,
                        enemy.y + enemy.height / 2,
                        enemy.color,
                        20
                    );
                    // 大型敌机用更响亮的爆炸音
                    playExplosionSound(enemy.size >= 50 ? 'big' : 'normal');
                    enemies.splice(enemyIndex, 1);
                    score += enemy.scoreValue;
                    scoreElement.textContent = score;
                }
            }
        });
    });
    
    // 敌人撞击玩家(造成敌人伤害值)
    enemies.forEach((enemy, index) => {
        if (player.invincible <= 0 &&
            player.x < enemy.x + enemy.width &&
            player.x + player.width > enemy.x &&
            player.y < enemy.y + enemy.height &&
            player.y + player.height > enemy.y) {
            
            createExplosion(
                enemy.x + enemy.width / 2,
                enemy.y + enemy.height / 2,
                enemy.color,
                20
            );
            enemies.splice(index, 1);
            lives -= enemy.damage;  // 多变伤害
            livesElement.textContent = lives;
            player.invincible = 60;
            
            if (lives <= 0) {
                lives = 0;
                livesElement.textContent = lives;
                gameOver();
            }
        }
    });
    
    // 敌人子弹击中玩家
    enemyBullets.forEach((bullet, bulletIndex) => {
        if (player.invincible <= 0 &&
            bullet.x < player.x + player.width &&
            bullet.x + bullet.width > player.x &&
            bullet.y < player.y + player.height &&
            bullet.y + bullet.height > player.y) {
            
            enemyBullets.splice(bulletIndex, 1);
            createExplosion(bullet.x, bullet.y, bullet.color, 8);
            lives -= bullet.damage;
            livesElement.textContent = lives;
            player.invincible = 60;
            
            if (lives <= 0) {
                lives = 0;
                livesElement.textContent = lives;
                gameOver();
            }
        }
    });
    
    // 玩家拾取补给包
    powerUps.forEach((pu, index) => {
        if (player.x < pu.x + pu.width &&
            player.x + player.width > pu.x &&
            player.y < pu.y + pu.height &&
            player.y + player.height > pu.y) {
            
            if (pu.type === 'life') {
                lives += 1;
            } else {
                // 护盾 = 短暂无敌
                player.invincible = 180;
            }
            livesElement.textContent = lives;
            createExplosion(
                pu.x + pu.width / 2,
                pu.y + pu.height / 2,
                pu.type === 'life' ? '#2ecc71' : '#3498db',
                15
            );
            powerUps.splice(index, 1);
        }
    });
}

function gameOver() {
    gameRunning = false;
    finalScoreElement.textContent = score;

    // 显示排行榜
    renderLeaderboard();

    // 重置保存分数区域状态
    saveScoreBtn.disabled = false;
    saveScoreBtn.textContent = '保存分数';
    playerNameInput.disabled = false;
    playerNameInput.value = '';

    // 分数能进榜才显示保存区域
    if (qualifiesForLeaderboard(score) && score > 0) {
        saveScoreSection.classList.remove('hidden');
        // 自动聚焦输入框
        setTimeout(() => playerNameInput.focus(), 100);
    } else {
        saveScoreSection.classList.add('hidden');
    }

    gameOverElement.classList.remove('hidden');
    // 游戏结束时暂停背景音乐
    stopBackgroundMusic();
}

function restartGame() {
    initAudio();  // 确保音频上下文已初始化(点击重新开始也是有效交互)
    score = 0;
    lives = 3;
    gameRunning = true;
    bullets = [];
    enemies = [];
    enemyBullets = [];
    powerUps = [];
    particles = [];
    enemySpawnRate = 60;
    player.x = canvas.width / 2 - 25;
    player.y = canvas.height - 80;
    player.invincible = 0;
    scoreElement.textContent = score;
    livesElement.textContent = lives;
    gameOverElement.classList.add('hidden');
    // 重新开始游戏时恢复背景音乐
    musicStarted = true;
    startBackgroundMusic();
    gameLoop();
}

function drawStars() {
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 80; i++) {
        const x = (Math.sin(i * 123.456) * 0.5 + 0.5) * canvas.width;
        const y = (frameCount * (0.5 + (i % 3) * 0.3) + i * 50) % canvas.height;
        const size = (Math.sin(i * 789.012) * 0.5 + 0.5) * 2 + 0.5;
        ctx.globalAlpha = 0.3 + (i % 3) * 0.2;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function gameLoop() {
    if (!gameRunning) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    drawStars();
    
    updatePlayer();
    drawPlayer();
    
    updateBullets();
    drawBullets();
    
    frameCount++;
    if (frameCount % enemySpawnRate === 0) {
        createEnemy();
    }
    
    // 随机刷新生命补给包
    if (frameCount % powerUpSpawnRate === 0) {
        createPowerUp();
    }
    
    updateEnemies();
    drawEnemies();
    
    updateEnemyBullets();
    drawEnemyBullets();
    
    updatePowerUps();
    drawPowerUps();
    
    updateParticles();
    drawParticles();
    
    checkCollisions();
    
    // 难度递增
    if (score > 0 && score % 100 === 0 && enemySpawnRate > 20) {
        enemySpawnRate = Math.max(20, 60 - Math.floor(score / 100) * 5);
    }
    
    requestAnimationFrame(gameLoop);
}

gameLoop();
