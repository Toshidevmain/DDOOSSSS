const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    telegramId: { type: Number, required: true, unique: true },
    username: String,
    firstName: String,
    isPremium: { type: Boolean, default: false },
    premiumExpiry: { type: Date, default: null },
    isAdmin: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
    attacksUsed: { type: Number, default: 0 },
    registeredAt: { type: Date, default: Date.now },
    lastAttackAt: Date
});

const User = mongoose.model("User", userSchema);

async function connectDB() {
    await mongoose.connect("mongodb+srv://toshidev0:zcode22107@dbtxt.3dxoaud.mongodb.net/DILDOSBOT");
    console.log("MongoDB connected");
}

async function registerUser(telegramId, username, firstName) {
    const existing = await User.findOne({ telegramId });
    if (existing) return existing;
    return await User.create({ telegramId, username, firstName });
}

async function getUser(telegramId) {
    return await User.findOne({ telegramId });
}

async function setAdmin(telegramId) {
    return await User.findOneAndUpdate(
        { telegramId },
        { isAdmin: true },
        { upsert: true, returnDocument: 'after' }
    );
}

async function removeAdmin(telegramId) {
    return await User.findOneAndUpdate(
        { telegramId },
        { isAdmin: false },
        { returnDocument: 'after' }
    );
}

async function setPremium(telegramId, days) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + days);
    return await User.findOneAndUpdate(
        { telegramId },
        { isPremium: true, premiumExpiry: expiry },
        { upsert: true, returnDocument: 'after' }
    );
}

async function removePremium(telegramId) {
    return await User.findOneAndUpdate(
        { telegramId },
        { isPremium: false, premiumExpiry: null },
        { returnDocument: 'after' }
    );
}

async function banUser(telegramId) {
    return await User.findOneAndUpdate(
        { telegramId },
        { isBanned: true },
        { upsert: true, returnDocument: 'after' }
    );
}

async function unbanUser(telegramId) {
    return await User.findOneAndUpdate(
        { telegramId },
        { isBanned: false },
        { returnDocument: 'after' }
    );
}

async function getAllUsers() {
    return await User.find({});
}

async function getPremiumUsers() {
    return await User.find({ isPremium: true });
}

async function getAdminUsers() {
    return await User.find({ isAdmin: true });
}

async function getAllRegisteredChatIds() {
    const users = await User.find({}, { telegramId: 1 });
    return users.map(u => u.telegramId);
}

async function incrementAttacks(telegramId) {
    return await User.findOneAndUpdate(
        { telegramId },
        { $inc: { attacksUsed: 1 }, lastAttackAt: new Date() }
    );
}

async function checkPremiumValidity() {
    const expired = await User.find({
        isPremium: true,
        premiumExpiry: { $ne: null, $lte: new Date() }
    });
    for (const user of expired) {
        user.isPremium = false;
        user.premiumExpiry = null;
        await user.save();
    }
    return expired.length;
}

module.exports = {
    connectDB,
    registerUser,
    getUser,
    setAdmin,
    removeAdmin,
    setPremium,
    removePremium,
    banUser,
    unbanUser,
    getAllUsers,
    getPremiumUsers,
    getAdminUsers,
    getAllRegisteredChatIds,
    incrementAttacks,
    checkPremiumValidity
};