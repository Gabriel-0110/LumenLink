const { Bot, InlineKeyboard } = require("grammy");
const { Coinbase, Wallet } = require("@coinbase/coinbase-sdk");
const Decimal = require("decimal.js");
const Web3 = require("web3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Simple JSON-file database (drop-in replacement for @replit/database)
// ---------------------------------------------------------------------------
class JsonDatabase {
  constructor(filePath) {
    this.filePath = filePath || path.join(__dirname, "wallets.json");
    this._data = {};
    if (fs.existsSync(this.filePath)) {
      try {
        this._data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      } catch {
        this._data = {};
      }
    }
  }
  _save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this._data, null, 2));
  }
  async get(key) {
    const value = this._data[key];
    return value !== undefined ? { value } : null;
  }
  async set(key, value) {
    this._data[key] = value;
    this._save();
  }
}

// ---------------------------------------------------------------------------
// Ensure environment variables are set
// ---------------------------------------------------------------------------
const requiredEnvVars = [
  "TELEGRAM_BOT_TOKEN",
  "COINBASE_API_KEY_NAME",
  "COINBASE_API_KEY_SECRET",
  "ENCRYPTION_KEY",
];

requiredEnvVars.forEach((env) => {
  if (!process.env[env]) {
    throw new Error(`missing ${env} environment variable`);
  }
});

// ---------------------------------------------------------------------------
// Create a bot object
// ---------------------------------------------------------------------------
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// In-memory storage for user states
const userStates = {};

// Database for storing wallets
const db = new JsonDatabase();

// ---------------------------------------------------------------------------
// Initialize Coinbase SDK
// ---------------------------------------------------------------------------
const privateKey = process.env.COINBASE_API_KEY_SECRET.replace(/\\n/g, "\n");
Coinbase.configure({
  apiKeyName: process.env.COINBASE_API_KEY_NAME,
  privateKey: privateKey,
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------
const updateUserState = (user, state) => {
  userStates[user.id] = { ...userStates[user.id], ...state };
};

const clearUserState = (user) => {
  delete userStates[user.id];
};

const sendReply = async (ctx, text, options = {}) => {
  const message = await ctx.reply(text, options);
  updateUserState(ctx.from, { messageId: message.message_id });
};

const handleUserState = async (ctx, handler) => {
  const userState = userStates[ctx.from.id] || {};
  if (
    ctx.message.reply_to_message &&
    ctx.message.reply_to_message.message_id === userState.messageId
  ) {
    await handler(ctx);
  } else {
    await ctx.reply("Please select an option from the menu.");
  }
};

// ---------------------------------------------------------------------------
// Encrypt and Decrypt functions
// ---------------------------------------------------------------------------
function encrypt(text, iv) {
  const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  const cipher = crypto.createCipheriv("aes-256-cbc", encryptionKey, iv);
  return cipher.update(text, "utf8", "hex") + cipher.final("hex");
}

function decrypt(encrypted, iv) {
  const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", encryptionKey, iv);
  return decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");
}

// ---------------------------------------------------------------------------
// Get or create the user's address
// ---------------------------------------------------------------------------
async function getOrCreateAddress(user) {
  if (userStates[user.id]?.address) {
    return userStates[user.id].address;
  }

  const result = await db.get(user.id.toString());

  let wallet;
  if (result?.value) {
    const { ivString, encryptedWalletData } = result.value;
    const iv = Buffer.from(ivString, "hex");
    const walletData = JSON.parse(decrypt(encryptedWalletData, iv));
    wallet = await Wallet.import(walletData);
  } else {
    wallet = await Wallet.create({ networkId: "base-mainnet" });
    const iv = crypto.randomBytes(16);
    const encryptedWalletData = encrypt(JSON.stringify(wallet.export()), iv);
    await db.set(user.id.toString(), {
      ivString: iv.toString("hex"),
      encryptedWalletData,
    });
  }

  updateUserState(user, { address: await wallet.getDefaultAddress() });

  return await wallet.getDefaultAddress();
}

// ---------------------------------------------------------------------------
// Handle checking balance
// ---------------------------------------------------------------------------
async function handleCheckBalance(ctx) {
  const userAddress = await getOrCreateAddress(ctx.from);
  const balanceMap = await userAddress.listBalances();
  const balancesString =
    balanceMap.size > 0
      ? balanceMap.toString().slice(11, -1)
      : "You have no balances.";
  await sendReply(
    ctx,
    `Your current balances are as follows:\n${balancesString}`,
  );
}

// ---------------------------------------------------------------------------
// Handle deposits
// ---------------------------------------------------------------------------
async function handleDeposit(ctx) {
  const userAddress = await getOrCreateAddress(ctx.from);
  await sendReply(
    ctx,
    "_Note: As this is a test app, make sure to deposit only small amounts of ETH!_",
    { parse_mode: "Markdown" },
  );
  await sendReply(
    ctx,
    "Please send your ETH to the following address on Base:",
  );
  await sendReply(ctx, `${userAddress.getId()}`, { parse_mode: "Markdown" });
}

// ---------------------------------------------------------------------------
// Handle initial withdrawal request
// ---------------------------------------------------------------------------
async function handleInitialWithdrawal(ctx) {
  updateUserState(ctx.from, { withdrawalRequested: true });
  await sendReply(
    ctx,
    "Please respond with the amount of ETH you want to withdraw.",
    { reply_markup: { force_reply: true } },
  );
}

// ---------------------------------------------------------------------------
// Handle withdrawals
// ---------------------------------------------------------------------------
async function handleWithdrawal(ctx) {
  const userState = userStates[ctx.from.id] || {};

  if (!userState.withdrawalAmount) {
    const withdrawalAmount = parseFloat(ctx.message.text);
    if (isNaN(withdrawalAmount)) {
      await ctx.reply("Invalid withdrawal amount. Please try again.");
      clearUserState(ctx.from);
    } else {
      const userAddress = await getOrCreateAddress(ctx.from);
      const currentBalance = await userAddress.getBalance(Coinbase.assets.Eth);
      if (new Decimal(withdrawalAmount).greaterThan(currentBalance)) {
        await ctx.reply("You do not have enough ETH to withdraw that amount.");
        clearUserState(ctx.from);
      } else {
        await sendReply(
          ctx,
          "Please respond with the address, ENS name, or Base name at which you would like to receive the ETH.",
          { reply_markup: { force_reply: true } },
        );
        updateUserState(ctx.from, {
          withdrawalAmount,
        });
      }
    }
  } else {
    const destination = ctx.message.text;
    if (!Web3.utils.isAddress(destination) && !destination.endsWith(".eth")) {
      await ctx.reply("Invalid destination address. Please try again.");
      clearUserState(ctx.from);
      return;
    }

    const userAddress = await getOrCreateAddress(ctx.from);

    try {
      await sendReply(ctx, "Initiating withdrawal...");
      const transfer = await userAddress.createTransfer({
        amount: userState.withdrawalAmount,
        assetId: Coinbase.assets.Eth,
        destination: destination,
      });
      await transfer.wait();
      await sendReply(
        ctx,
        `Successfully completed withdrawal: [Basescan Link](${transfer.getTransactionLink()})`,
        { parse_mode: "Markdown" },
      );
      clearUserState(ctx.from);
    } catch (error) {
      await ctx.reply("An error occurred while initiating the transfer.");
      console.error(error);
      clearUserState(ctx.from);
    }
  }
}

// ---------------------------------------------------------------------------
// Handle buy request
// ---------------------------------------------------------------------------
async function handleInitialBuy(ctx) {
  await handleTradeInit(ctx, "buy");
}

async function handleBuy(ctx) {
  await executeTrade(ctx, "buy");
}

// ---------------------------------------------------------------------------
// Handle sell request
// ---------------------------------------------------------------------------
async function handleInitialSell(ctx) {
  await handleTradeInit(ctx, "sell");
}

async function handleSell(ctx) {
  await executeTrade(ctx, "sell");
}

// ---------------------------------------------------------------------------
// Initialize trade (Buy/Sell)
// ---------------------------------------------------------------------------
async function handleTradeInit(ctx, type) {
  const prompt =
    type === "buy"
      ? "Please respond with the asset you would like to buy (ticker or contract address)."
      : "Please respond with the asset you would like to sell (ticker or contract address).";
  updateUserState(ctx.from, { [`${type}Requested`]: true });
  await sendReply(ctx, prompt, { reply_markup: { force_reply: true } });
}

// ---------------------------------------------------------------------------
// Generalized function to execute trades
// ---------------------------------------------------------------------------
async function executeTrade(ctx, type) {
  const userState = userStates[ctx.from.id] || {};
  if (!userState.asset) {
    // Prevent sale of ETH and log asset to user state
    if (ctx.message.text.toLowerCase() === "eth" && type === "sell") {
      await ctx.reply(
        "You cannot sell ETH, as it is the quote currency. Please try again.",
      );
      clearUserState(ctx.from);
      return;
    }

    updateUserState(ctx.from, { asset: ctx.message.text.toLowerCase() });

    const prompt =
      type === "buy"
        ? "Please respond with the amount of ETH you would like to spend."
        : "Please respond with the amount of the asset you would like to sell.";
    await sendReply(ctx, prompt, { reply_markup: { force_reply: true } });
  } else {
    const amount = new Decimal(parseFloat(ctx.message.text));
    const userAddress = await getOrCreateAddress(ctx.from);
    const currentBalance = await userAddress.getBalance(
      type === "buy" ? Coinbase.assets.Eth : userState.asset,
    );
    if (amount.isNaN() || amount.greaterThan(currentBalance)) {
      await ctx.reply(
        "Invalid amount or insufficient balance. Please try again.",
      );
      clearUserState(ctx.from);
    } else {
      const tradeType =
        type === "buy"
          ? { fromAssetId: Coinbase.assets.Eth, toAssetId: userState.asset }
          : { fromAssetId: userState.asset, toAssetId: Coinbase.assets.Eth };
      await sendReply(ctx, `Initiating ${type}...`);
      try {
        const userAddress = await getOrCreateAddress(ctx.from);
        const trade = await userAddress.createTrade({ amount, ...tradeType });
        await trade.wait();
        await sendReply(
          ctx,
          `Successfully completed ${type}: [Basescan Link](${trade.getTransaction().getTransactionLink()})`,
          { parse_mode: "Markdown" },
        );
        clearUserState(ctx.from);
      } catch (error) {
        await ctx.reply(`An error occurred while initiating the ${type}.`);
        console.error(error);
        clearUserState(ctx.from);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Handle pinning the start message
// ---------------------------------------------------------------------------
async function handlePinMessage(ctx) {
  try {
    await ctx.api.pinChatMessage(
      ctx.chat.id,
      userStates[ctx.from.id].messageId,
    );
    await ctx.reply("Message pinned successfully!");
  } catch (error) {
    console.error("Failed to pin the message:", error);
    await ctx.reply(
      "Failed to pin the message. Ensure the bot has the proper permissions.",
    );
  }
  clearUserState(ctx.from);
}

// ---------------------------------------------------------------------------
// Handle exporting the key
// ---------------------------------------------------------------------------
async function handleExportKey(ctx) {
  const userAddress = await getOrCreateAddress(ctx.from);
  const exportedKey = userAddress.export();
  await sendReply(
    ctx,
    "Your private key will be in the next message. Do NOT share it with anyone, and make sure you store it in a safe place.",
  );
  await sendReply(ctx, exportedKey);
}

// ---------------------------------------------------------------------------
// Bot command handlers – /start
// ---------------------------------------------------------------------------
bot.command("start", async (ctx) => {
  const { from: user } = ctx;
  updateUserState(user, {});
  const userAddress = await getOrCreateAddress(user);

  const keyboard = new InlineKeyboard()
    .text("Check Balance", "check_balance")
    .row()
    .text("Deposit ETH", "deposit_eth")
    .row()
    .text("Withdraw ETH", "withdraw_eth")
    .row()
    .text("Buy", "buy")
    .text("Sell", "sell")
    .row()
    .text("Export key", "export_key")
    .text("Pin message", "pin_message");

  const welcomeMessage = `
  *Welcome to your Onchain Trading Bot!*
  Your Base address is ${userAddress.getId()}.
  Select an option below:`;

  await sendReply(ctx, welcomeMessage, {
    reply_markup: keyboard,
    parse_mode: "Markdown",
  });
});

// ---------------------------------------------------------------------------
// Callback query handlers
// ---------------------------------------------------------------------------
const callbackHandlers = {
  check_balance: handleCheckBalance,
  deposit_eth: handleDeposit,
  withdraw_eth: handleInitialWithdrawal,
  buy: handleInitialBuy,
  sell: handleInitialSell,
  pin_message: handlePinMessage,
  export_key: handleExportKey,
};

bot.on("callback_query:data", async (ctx) => {
  const handler = callbackHandlers[ctx.callbackQuery.data];
  if (handler) {
    await ctx.answerCallbackQuery();
    await handler(ctx);
  } else {
    await ctx.reply("Unknown button clicked!");
  }
  console.log(
    `User ID: ${ctx.from.id}, Username: ${ctx.from.username}, First Name: ${ctx.from.first_name}`,
  );
});

// ---------------------------------------------------------------------------
// Handle user messages
// ---------------------------------------------------------------------------
bot.on("message:text", async (ctx) =>
  handleUserState(ctx, async () => {
    const userState = userStates[ctx.from.id] || {};
    if (userState.withdrawalRequested) await handleWithdrawal(ctx);
    else if (userState.buyRequested) await handleBuy(ctx);
    else if (userState.sellRequested) await handleSell(ctx);
  }),
);

// ---------------------------------------------------------------------------
// Error handler – log errors without crashing
// ---------------------------------------------------------------------------
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  if (e.constructor?.name === "GrammyError") {
    console.error("Telegram API error:", e.description);
  } else if (e.constructor?.name === "HttpError") {
    console.error("Network error:", e);
  } else {
    console.error("Unknown error:", e);
  }
  // Try to inform the user
  ctx.reply("An error occurred. Please try again later.").catch(() => {});
});

// ---------------------------------------------------------------------------
// Start the bot (using long polling)
// ---------------------------------------------------------------------------
bot.start();

console.log("Trading bot is running...");