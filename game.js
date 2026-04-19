const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let width, height;
function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
}
window.addEventListener('resize', resize);
resize();

window.WORLD_WIDTH = 4000;
window.WORLD_HEIGHT = 4000;

let camera = { x: 0, y: 0 };
let player = new RpgPlayer(window.WORLD_WIDTH / 2, window.WORLD_HEIGHT / 2);
let enemies = [];
let projectiles = [];
let gems = [];

let isPlaying = false; // Start false, wait for login
let animationId;
let enemySpawnTimer = 0;
let nickname = "Player";
let autoAim = true;

// ─── 닉네임 유효성 검사 함수 ───
function validateNickname(name) {
    if (name.length < 2) return '닉네임은 최소 2글자 이상이어야 합니다.';
    if (name.length > 12) return '닉네임은 12글자 이하여야 합니다.';
    if (!/^[a-zA-Z0-9가-힣_]+$/.test(name)) return '영문, 숫자, 한글, _만 사용 가능합니다.';
    return null;
}

// 이전 닉네임 불러오기
const savedNickname = localStorage.getItem('rpgSurvival_nickname');
if (savedNickname) {
    document.getElementById('login-nickname').value = savedNickname;
}

// Login Logic
document.getElementById('login-start-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('login-nickname').value.trim();
    const errorEl = document.getElementById('login-error');

    // 유효성 검사
    const validErr = validateNickname(nameInput);
    if (validErr) {
        errorEl.textContent = validErr;
        return;
    }

    // 닉네임 중복 체크 (현재 접속 중인 플레이어 목록과 비교 - PartyKit 연동 시 서버에서 처리)
    const takenNicknames = JSON.parse(localStorage.getItem('rpgSurvival_taken') || '[]');
    // 이전에 본인이 쓰던 닉네임이면 허용
    const myOldNickname = localStorage.getItem('rpgSurvival_nickname');
    if (nameInput !== myOldNickname && takenNicknames.includes(nameInput)) {
        errorEl.textContent = '이미 사용 중인 닉네임입니다. 다른 닉네임을 선택하세요.';
        return;
    }

    errorEl.textContent = '';
    nickname = nameInput;
    localStorage.setItem('rpgSurvival_nickname', nickname);

    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');

    // 모바일 조이스틱 표시
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
        document.getElementById('mobile-controls').classList.remove('hidden');
    }

    isPlaying = true;
    loop();
});

// Enter 키로도 로그인 가능
document.getElementById('login-nickname').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-start-btn').click();
});

// Settings Logic
document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('hidden');
});
document.getElementById('close-settings-btn').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
});
document.getElementById('auto-aim-toggle').addEventListener('change', (e) => {
    autoAim = e.target.checked;
    if (autoAim) {
        document.getElementById('joystick-right').classList.add('hidden');
    } else {
        document.getElementById('joystick-right').classList.remove('hidden');
    }
});

// Mobile Joysticks Logic
function setupJoystick(zoneId, callback) {
    const zone = document.getElementById(zoneId);
    const base = zone.querySelector('.joystick-base');
    const stick = zone.querySelector('.joystick-stick');
    
    let activeTouchId = null;
    let baseX = 0, baseY = 0;
    const maxDist = 35; // px

    zone.addEventListener('touchstart', e => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (activeTouchId === null) {
                const touch = e.changedTouches[i];
                activeTouchId = touch.identifier;
                
                base.style.display = 'block';
                base.style.left = touch.clientX + 'px';
                base.style.top = touch.clientY + 'px';
                base.style.bottom = 'auto'; // override css bottom
                base.style.transform = 'translate(-50%, -50%)';
                
                baseX = touch.clientX;
                baseY = touch.clientY;
                stick.style.transform = `translate(-50%, -50%)`;
                callback(0, 0);
            }
        }
    }, {passive: false});

    zone.addEventListener('touchmove', e => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === activeTouchId) {
                const touch = e.changedTouches[i];
                const dx = touch.clientX - baseX;
                const dy = touch.clientY - baseY;
                const dist = Math.hypot(dx, dy);
                
                let nx = dx, ny = dy;
                if (dist > maxDist) {
                    nx = (dx / dist) * maxDist;
                    ny = (dy / dist) * maxDist;
                }
                
                stick.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
                
                // Return normalized -1 to 1
                callback(nx / maxDist, ny / maxDist);
            }
        }
    }, {passive: false});

    const handleEnd = e => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === activeTouchId) {
                activeTouchId = null;
                base.style.display = 'none';
                stick.style.transform = `translate(-50%, -50%)`;
                callback(0, 0);
            }
        }
    };
    zone.addEventListener('touchend', handleEnd, {passive: false});
    zone.addEventListener('touchcancel', handleEnd, {passive: false});
}

setupJoystick('joystick-left', (nx, ny) => {
    player.joyMove.x = nx;
    player.joyMove.y = ny;
});

setupJoystick('joystick-right', (nx, ny) => {
    player.joyAim.x = nx;
    player.joyAim.y = ny;
});

// Input handling
window.addEventListener('keydown', e => player.keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => player.keys[e.key.toLowerCase()] = false);

window.addEventListener('mousedown', e => {
    if (e.button === 0) player.isAttacking = true;
});
window.addEventListener('mouseup', e => {
    if (e.button === 0) player.isAttacking = false;
});
window.addEventListener('mousemove', e => {
    player.mouseX = e.clientX;
    player.mouseY = e.clientY;
});

function drawGrid(ctx) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 2;
    const gridSize = 100;

    // Draw only visible grid lines for performance
    const startX = Math.floor(camera.x / gridSize) * gridSize;
    const startY = Math.floor(camera.y / gridSize) * gridSize;
    const endX = startX + width + gridSize * 2;
    const endY = startY + height + gridSize * 2;

    ctx.beginPath();
    for (let x = startX; x <= Math.min(window.WORLD_WIDTH, endX); x += gridSize) {
        ctx.moveTo(x, Math.max(0, startY));
        ctx.lineTo(x, Math.min(window.WORLD_HEIGHT, endY));
    }
    for (let y = startY; y <= Math.min(window.WORLD_HEIGHT, endY); y += gridSize) {
        ctx.moveTo(Math.max(0, startX), y);
        ctx.lineTo(Math.min(window.WORLD_WIDTH, endX), y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, window.WORLD_WIDTH, window.WORLD_HEIGHT);
}

function drawMinimap(ctx) {
    const mmWidth = 200;
    const mmHeight = 200;
    const padding = 20;
    const mmX = width - mmWidth - padding;
    const mmY = padding;

    ctx.save();
    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.fillRect(mmX, mmY, mmWidth, mmHeight);
    ctx.strokeRect(mmX, mmY, mmWidth, mmHeight);

    // Scale factors
    const scaleX = mmWidth / window.WORLD_WIDTH;
    const scaleY = mmHeight / window.WORLD_HEIGHT;

    // Camera Viewport Box
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.strokeRect(mmX + camera.x * scaleX, mmY + camera.y * scaleY, width * scaleX, height * scaleY);

    // Enemies
    ctx.fillStyle = '#ef4444';
    for (let e of enemies) {
        ctx.fillRect(mmX + e.x * scaleX - 1, mmY + e.y * scaleY - 1, 2, 2);
    }

    // Player
    ctx.fillStyle = '#60a5fa';
    ctx.fillRect(mmX + player.x * scaleX - 2, mmY + player.y * scaleY - 2, 4, 4);

    ctx.restore();
}

function updateHUD() {
    document.getElementById('player-level').innerText = player.level;
    document.getElementById('player-kills').innerText = player.kills;
    
    const hpPerc = Math.max(0, player.hp / player.maxHp) * 100;
    document.getElementById('hp-bar').style.width = hpPerc + '%';
    document.getElementById('hp-text').innerText = `${Math.ceil(player.hp)} / ${player.maxHp}`;
    
    const expPerc = (player.exp / player.maxExp) * 100;
    document.getElementById('exp-bar').style.width = expPerc + '%';
    document.getElementById('exp-text').innerText = `${player.exp} / ${player.maxExp}`;
    
    document.getElementById('stat-dmg').innerText = player.damage;
    document.getElementById('stat-spd').innerText = player.speed.toFixed(1);
    const atkSpd = (60 / player.attackCooldown).toFixed(1);
    document.getElementById('stat-atkspd').innerText = atkSpd;
}

function spawnEnemy() {
    const angle = Math.random() * Math.PI * 2;
    const dist = 600 + Math.random() * 200; // Spawn outside screen
    let ex = player.x + Math.cos(angle) * dist;
    let ey = player.y + Math.sin(angle) * dist;
    
    ex = Math.max(0, Math.min(window.WORLD_WIDTH, ex));
    ey = Math.max(0, Math.min(window.WORLD_HEIGHT, ey));

    enemies.push(new RpgEnemy(ex, ey, player.level));
}

function gameOver() {
    isPlaying = false;
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('death-screen').classList.remove('hidden');
    document.getElementById('final-level').innerText = player.level;
    document.getElementById('final-kills').innerText = player.kills;
}

document.getElementById('restart-btn').addEventListener('click', () => {
    player = new RpgPlayer(window.WORLD_WIDTH / 2, window.WORLD_HEIGHT / 2);
    enemies = [];
    projectiles = [];
    gems = [];
    isPlaying = true;
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('death-screen').classList.add('hidden');
    loop();
});

function loop() {
    if (!isPlaying) return;

    // Camera follow player (center screen)
    camera.x = player.x - width / 2;
    camera.y = player.y - height / 2;
    
    // Clamp camera
    camera.x = Math.max(0, Math.min(window.WORLD_WIDTH - width, camera.x));
    camera.y = Math.max(0, Math.min(window.WORLD_HEIGHT - height, camera.y));

    // Update
    player.update(projectiles, camera.x, camera.y, enemies, autoAim);
    
    if (!player.isAlive) {
        gameOver();
        return;
    }

    enemySpawnTimer++;
    // Spawn rate increases with level
    const spawnRate = Math.max(20, 100 - player.level * 5);
    if (enemySpawnTimer > spawnRate) {
        spawnEnemy();
        enemySpawnTimer = 0;
    }

    projectiles.forEach(p => p.update(enemies));
    projectiles = projectiles.filter(p => p.active);

    enemies.forEach(e => {
        e.update(player);
        if (!e.isAlive && e.hp <= 0 && e.expValue > 0) {
            gems.push(new ExpGem(e.x, e.y, e.expValue));
            player.kills++;
            e.expValue = 0; // Prevent multiple drops
        }
    });
    enemies = enemies.filter(e => e.isAlive);

    gems.forEach(g => g.update(player));
    gems = gems.filter(g => g.active);

    updateHUD();

    // Draw
    ctx.clearRect(0, 0, width, height);
    
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    
    drawGrid(ctx);
    
    gems.forEach(g => g.draw(ctx));
    projectiles.forEach(p => p.draw(ctx));
    enemies.forEach(e => e.draw(ctx));
    
    player.draw(ctx, camera.x, camera.y);
    
    // Draw Nickname
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(nickname, player.x, player.y - player.radius - 15);
    
    ctx.restore();

    // Draw minimap on top of everything (UI coordinates)
    drawMinimap(ctx);

    animationId = requestAnimationFrame(loop);
}

// Start immediately with empty canvas, game loop won't run logic until isPlaying is true
ctx.clearRect(0, 0, width, height);
drawGrid(ctx);
