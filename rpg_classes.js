class RpgProjectile {
    constructor(x, y, targetX, targetY, damage) {
        this.x = x;
        this.y = y;
        this.damage = damage;
        this.speed = 12;
        this.active = true;
        this.radius = 4;
        
        this.distanceTraveled = 0;
        this.maxRange = 600;

        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.hypot(dx, dy);
        
        if (dist > 0) {
            this.vx = (dx / dist) * this.speed;
            this.vy = (dy / dist) * this.speed;
        } else {
            this.vx = 0;
            this.vy = 0;
        }
        
        this.angle = Math.atan2(this.vy, this.vx);
    }

    update(enemies) {
        if (!this.active) return;

        this.x += this.vx;
        this.y += this.vy;
        
        this.distanceTraveled += this.speed;
        if (this.distanceTraveled > this.maxRange) {
            this.active = false;
            return;
        }

        // Check bounds
        if (this.x < 0 || this.x > window.WORLD_WIDTH || this.y < 0 || this.y > window.WORLD_HEIGHT) {
            this.active = false;
            return;
        }

        // Hit enemies
        for (let enemy of enemies) {
            if (enemy.isAlive) {
                const dist = Math.hypot(enemy.x - this.x, enemy.y - this.y);
                if (dist < enemy.radius + this.radius) {
                    enemy.takeDamage(this.damage);
                    this.active = false;
                    return;
                }
            }
        }
    }

    draw(ctx) {
        if (!this.active) return;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        ctx.fillStyle = '#60a5fa'; // Blue arrow
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(-6, 4);
        ctx.lineTo(-6, -4);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }
}

class ExpGem {
    constructor(x, y, amount) {
        this.x = x;
        this.y = y;
        this.amount = amount;
        this.radius = 6;
        this.active = true;
        this.floatY = Math.random() * Math.PI * 2;
    }
    
    update(player) {
        if (!this.active) return;
        this.floatY += 0.1;
        
        const dist = Math.hypot(player.x - this.x, player.y - this.y);
        
        // Magnet effect if close
        if (dist < 100) {
            this.x += (player.x - this.x) / dist * 5;
            this.y += (player.y - this.y) / dist * 5;
        }
        
        if (dist < player.radius + this.radius) {
            player.gainExp(this.amount);
            this.active = false;
        }
    }
    
    draw(ctx) {
        if (!this.active) return;
        ctx.save();
        ctx.translate(this.x, this.y + Math.sin(this.floatY) * 3);
        ctx.fillStyle = '#34d399';
        ctx.shadowColor = '#10b981';
        ctx.shadowBlur = 10;
        
        ctx.beginPath();
        ctx.moveTo(0, -this.radius);
        ctx.lineTo(this.radius, 0);
        ctx.lineTo(0, this.radius);
        ctx.lineTo(-this.radius, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

class RpgPlayer {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        
        this.level = 1;
        this.exp = 0;
        this.maxExp = 100;
        this.kills = 0;
        
        this.maxHp = 100;
        this.hp = this.maxHp;
        this.speed = 4;
        this.damage = 20;
        this.attackCooldown = 30; // Frames
        
        this.radius = 16;
        this.isAlive = true;
        this.cooldownTimer = 0;
        this.walkCycle = 0;
        this.color = '#3b82f6';
        
        // Input state
        this.keys = {};
        this.mouseX = 0;
        this.mouseY = 0;
        this.isAttacking = false;
        
        // Mobile Joysticks
        this.joyMove = { x: 0, y: 0 };
        this.joyAim = { x: 0, y: 0 };
    }

    gainExp(amount) {
        this.exp += amount;
        if (this.exp >= this.maxExp) {
            this.levelUp();
        }
    }

    levelUp() {
        this.level++;
        this.exp -= this.maxExp;
        this.maxExp = Math.floor(this.maxExp * 1.5);
        
        // Stat boosts
        this.maxHp += 20;
        this.hp = this.maxHp; // Heal on level up
        this.damage += 5;
        this.speed = Math.min(this.speed + 0.2, 8);
        this.attackCooldown = Math.max(10, this.attackCooldown - 2);
        
        // Trigger UI event
        const banner = document.getElementById('level-up-banner');
        banner.classList.remove('hidden');
        banner.style.animation = 'none';
        banner.offsetHeight; /* trigger reflow */
        banner.style.animation = null; 
    }

    takeDamage(amount) {
        if (!this.isAlive) return;
        this.hp -= amount;
        if (this.hp <= 0) {
            this.hp = 0;
            this.isAlive = false;
        }
    }

    update(projectiles, cameraX, cameraY, enemies, autoAim) {
        if (!this.isAlive) return;

        if (this.cooldownTimer > 0) this.cooldownTimer--;

        // Movement
        this.vx = 0;
        this.vy = 0;
        
        // Keyboard
        if (this.keys['w'] || this.keys['arrowup']) this.vy -= this.speed;
        if (this.keys['s'] || this.keys['arrowdown']) this.vy += this.speed;
        if (this.keys['a'] || this.keys['arrowleft']) this.vx -= this.speed;
        if (this.keys['d'] || this.keys['arrowright']) this.vx += this.speed;

        // Joystick Move Override
        if (this.joyMove.x !== 0 || this.joyMove.y !== 0) {
            this.vx = this.joyMove.x * this.speed;
            this.vy = this.joyMove.y * this.speed;
        }

        // Normalize diagonal
        if (this.vx !== 0 && this.vy !== 0 && (this.joyMove.x === 0 && this.joyMove.y === 0)) {
            const len = Math.hypot(this.vx, this.vy);
            this.vx = (this.vx / len) * this.speed;
            this.vy = (this.vy / len) * this.speed;
        }

        this.x += this.vx;
        this.y += this.vy;

        if (this.vx !== 0 || this.vy !== 0) {
            this.walkCycle += 0.2;
        }

        // Bounds
        this.x = Math.max(this.radius, Math.min(window.WORLD_WIDTH - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(window.WORLD_HEIGHT - this.radius, this.y));

        // Attack Logic
        if (this.cooldownTimer <= 0) {
            let targetX = null;
            let targetY = null;
            let shouldShoot = false;

            if (autoAim && enemies.length > 0) {
                // Find closest enemy
                let closestDist = Infinity;
                let closestEnemy = null;
                for (let e of enemies) {
                    const d = Math.hypot(e.x - this.x, e.y - this.y);
                    if (d < closestDist) {
                        closestDist = d;
                        closestEnemy = e;
                    }
                }
                if (closestEnemy && closestDist < 600) { // Max range 600
                    targetX = closestEnemy.x;
                    targetY = closestEnemy.y;
                    shouldShoot = true;
                }
            } else if (!autoAim && (this.joyAim.x !== 0 || this.joyAim.y !== 0)) {
                // Manual Aim (Mobile Joystick)
                targetX = this.x + this.joyAim.x * 100;
                targetY = this.y + this.joyAim.y * 100;
                shouldShoot = true;
            } else if (this.isAttacking) {
                // Mouse Aim
                targetX = this.mouseX + cameraX;
                targetY = this.mouseY + cameraY;
                shouldShoot = true;
            }

            if (shouldShoot && targetX !== null && targetY !== null) {
                projectiles.push(new RpgProjectile(this.x, this.y, targetX, targetY, this.damage));
                this.cooldownTimer = this.attackCooldown;
                // Update mouse proxy for drawing facing direction
                this.mouseX = targetX - cameraX;
                this.mouseY = targetY - cameraY;
            }
        }
    }

    draw(ctx, cameraX, cameraY) {
        if (!this.isAlive) return;
        
        ctx.save();
        ctx.translate(this.x, this.y);
        
        // Face mouse
        const worldMouseX = this.mouseX + cameraX;
        let facingRight = worldMouseX > this.x;
        if (!facingRight) ctx.scale(-1, 1);

        ctx.strokeStyle = this.color;
        ctx.fillStyle = this.color;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const s = this.radius / 12;

        // Head
        ctx.beginPath();
        ctx.arc(0, -6 * s, 5 * s, 0, Math.PI * 2);
        ctx.stroke();

        // Body
        ctx.beginPath();
        ctx.moveTo(0, -1 * s);
        ctx.lineTo(0, 8 * s);
        ctx.stroke();

        // Legs
        const legOffset = Math.sin(this.walkCycle) * 6 * s;
        ctx.beginPath();
        ctx.moveTo(0, 8 * s);
        ctx.lineTo(-6 * s, 16 * s + legOffset);
        ctx.moveTo(0, 8 * s);
        ctx.lineTo(6 * s, 16 * s - legOffset);
        ctx.stroke();

        // Arms holding a bow-like shape
        ctx.beginPath();
        ctx.moveTo(0, 2 * s);
        ctx.lineTo(8 * s, 0);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(8 * s, 0, 10 * s, -Math.PI/2, Math.PI/2);
        ctx.strokeStyle = '#e2e8f0';
        ctx.stroke();

        let pullX = 0;
        if (this.cooldownTimer < this.attackCooldown * 0.3) pullX = -5 * s;
        
        ctx.beginPath();
        ctx.moveTo(0, 2 * s);
        ctx.lineTo(pullX, 0);
        ctx.strokeStyle = this.color;
        ctx.stroke();

        ctx.restore();
    }
}

class RpgEnemy {
    constructor(x, y, difficultyLevel) {
        this.x = x;
        this.y = y;
        this.radius = 14 + Math.random() * 4;
        
        this.maxHp = 30 + difficultyLevel * 10;
        this.hp = this.maxHp;
        this.speed = 1.5 + Math.random() * 1.5 + (difficultyLevel * 0.1);
        this.damage = 5 + difficultyLevel * 2;
        this.expValue = 10 + difficultyLevel * 5;
        
        this.isAlive = true;
        this.walkCycle = Math.random() * Math.PI * 2;
        
        // Random color
        const hues = [0, 30, 280, 120];
        this.color = `hsl(${hues[Math.floor(Math.random()*hues.length)]}, 80%, 60%)`;
        this.attackTimer = 0;
    }

    takeDamage(amount) {
        if (!this.isAlive) return;
        this.hp -= amount;
        if (this.hp <= 0) {
            this.hp = 0;
            this.isAlive = false;
        }
    }

    update(player) {
        if (!this.isAlive) return;
        if (this.attackTimer > 0) this.attackTimer--;

        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const dist = Math.hypot(dx, dy);

        if (dist > this.radius + player.radius) {
            this.x += (dx / dist) * this.speed;
            this.y += (dy / dist) * this.speed;
            this.walkCycle += 0.15;
        } else {
            // Attack player
            if (this.attackTimer <= 0) {
                player.takeDamage(this.damage);
                this.attackTimer = 60; // 1 attack per second
            }
        }
    }

    draw(ctx) {
        if (!this.isAlive) return;
        
        ctx.save();
        ctx.translate(this.x, this.y);
        
        // Simple red/enemy HP bar
        if (this.hp < this.maxHp) {
            ctx.fillStyle = 'black';
            ctx.fillRect(-15, -25, 30, 4);
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(-15, -25, 30 * (this.hp / this.maxHp), 4);
        }

        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const s = this.radius / 12;

        ctx.beginPath();
        ctx.arc(0, -4 * s, 4 * s, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 8 * s);
        ctx.stroke();

        const legOffset = Math.sin(this.walkCycle) * 5 * s;
        ctx.beginPath();
        ctx.moveTo(0, 8 * s);
        ctx.lineTo(-5 * s, 15 * s + legOffset);
        ctx.moveTo(0, 8 * s);
        ctx.lineTo(5 * s, 15 * s - legOffset);
        ctx.stroke();

        // Zombie-like arms
        ctx.beginPath();
        ctx.moveTo(0, 2 * s);
        ctx.lineTo(8 * s, 4 * s);
        ctx.moveTo(0, 2 * s);
        ctx.lineTo(-8 * s, 4 * s);
        ctx.stroke();

        ctx.restore();
    }
}
