// =================== WEB SERVER GIỮ BOT 24/7 ===================
const express = require('express');
const keepAliveApp = express();

keepAliveApp.get('/', (req, res) => {
    res.send('Bot is running!');
});

const KEEP_ALIVE_PORT = process.env.PORT || 3000;
keepAliveApp.listen(KEEP_ALIVE_PORT, () => {
    console.log(`Web server is running on port ${KEEP_ALIVE_PORT}`);
});


// =================== CONFIG ===================
const orderChannelId = "1447582955307532288"; 
const token = process.env.DISCORD_TOKEN; // <-- BẮT BUỘC THAY TOKEN MỚI
const clientId = "1448303674563629096";
const guildId = "952778721474002997";
// ===============================================


// =================== DATABASE ===================
const Database = require('better-sqlite3');
const db = new Database('orders.db');

db.prepare(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT,
  customerInfo TEXT,
  price TEXT,
  note TEXT,
  expireAt INTEGER,
  status TEXT,
  channelId TEXT,
  messageId TEXT,
  createdAt INTEGER
)`).run();

function insertOrder(o) {
  const stmt = db.prepare(`
    INSERT INTO orders (product, customerInfo, price, note, expireAt, status, channelId, messageId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(o.product, o.customerInfo, o.price, o.note, o.expireAt, o.status, o.channelId, o.messageId, o.createdAt).lastInsertRowid;
}

function getPendingOrders() {
  return db.prepare(`SELECT * FROM orders WHERE status = 'pending'`).all();
}

function markOrderExpiredInDB(id) {
  db.prepare(`UPDATE orders SET status = 'expired' WHERE id = ?`).run(id);
}


// =================== DISCORD BOT ===================
const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder
} = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });


// ========== REGISTER COMMANDS ==========
const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  const commands = [
    new SlashCommandBuilder()
      .setName('menu-don')
      .setDescription('Hiện bảng quản lý đơn hàng')
      .toJSON()
  ];

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log('Đã đăng ký /menu-don');
})();


// ========== EXPIRATION SYSTEM ==========
client.once("ready", () => {
  console.log(`Bot đang chạy: ${client.user.tag}`);

  const pendings = getPendingOrders();
  for (const o of pendings) scheduleExpireCheck(o);
});

function scheduleExpireCheck(order) {
  const msLeft = order.expireAt - Date.now();
  if (msLeft <= 0) return markExpired(order);

  setTimeout(() => markExpired(order), msLeft);
}

async function markExpired(order) {
  markOrderExpiredInDB(order.id);

  try {
    const ch = await client.channels.fetch(order.channelId);
    const msg = await ch.messages.fetch(order.messageId);

    const newEmbed = EmbedBuilder
      .from(msg.embeds[0])
      .setColor("Red")
      .setFooter({ text: "Đã hết hạn" });

    await msg.edit({ embeds: [newEmbed] });
    await ch.send(`🔴 Đơn hàng **${order.product}** (ID: ${order.id}) đã hết hạn.`);
  } 
  catch (err) {
    console.log("Lỗi khi chỉnh đơn hết hạn:", err.message);
  }
}


// =================== INTERACTION HANDLER ===================
client.on("interactionCreate", async (interaction) => {

  // ================== /menu-don ==================
  if (interaction.isChatInputCommand() && interaction.commandName === "menu-don") {
    
    const embed = new EmbedBuilder()
      .setColor("#2b8eff")
      .setTitle("📦 MENU ĐƠN HÀNG")
      .setDescription("Nhấn nút bên dưới để tạo đơn hàng mới.")
      .setFooter({ text: "TCF SHOP 🐧" });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("btn_tao_don")
        .setLabel("Tạo Đơn Hàng")
        .setEmoji("📦")
        .setStyle(ButtonStyle.Primary)
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }


  // ================== BUTTON: TẠO ĐƠN ==================
  if (interaction.isButton() && interaction.customId === "btn_tao_don") {
    
    const modal = new ModalBuilder()
      .setCustomId("modal_don")
      .setTitle("Thông tin đơn hàng");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("ten")
          .setLabel("Tên mặt hàng / mã ticket")
	  .setPlaceholder("Ví dụ: name #0001")
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("info")
          .setLabel("Thông tin khách hàng")
	  .setPlaceholder("Ví dụ:  NG . Vanhh | nhập đúng tên khách hàng")
          .setRequired(true)
          .setStyle(TextInputStyle.Paragraph)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("expire_hour")
          .setLabel("Hết hạn sau bao nhiêu giờ?")
	  .setPlaceholder("Ví dụ: 1")
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("price")
          .setLabel("Giá")
	  .setPlaceholder("Ví dụ: 1500000đ")
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("note")
          .setLabel("Ghi chú")
	  .setPlaceholder("Ghi Tên Người nhận đơn này")
          .setRequired(false)
          .setStyle(TextInputStyle.Paragraph)
      )
    );

    return interaction.showModal(modal);
  }


  // ================== SUBMIT MODAL ==================
  if (interaction.isModalSubmit() && interaction.customId === "modal_don") {

    await interaction.deferReply({ ephemeral: true });

    const ten = interaction.fields.getTextInputValue("ten");
    let info = interaction.fields.getTextInputValue("info").trim();

// ========== TỰ TÌM USER THEO TÊN ==========
async function findUserByName(name) {
    // lấy danh sách member
    const guild = interaction.guild;
    async function findUserByName(name) {
    const guild = interaction.guild;
    const lower = name.toLowerCase();

    // Tìm trong cache trước (nhanh)
    let match = guild.members.cache.filter(m =>
        m.user.username.toLowerCase().includes(lower) ||
        m.displayName.toLowerCase().includes(lower)
    );

    // Nếu tìm thấy trong cache → dùng luôn
    if (match.size === 1) return match.first();
    if (match.size > 1) return "multiple";

    // Nếu cache không đủ → gọi API tìm kiếm
    match = await guild.members.search({ query: name, limit: 5 });

    if (match.size === 0) return null;
    if (match.size > 1) return "multiple";

    return match.first();
} // đảm bảo cache đầy đủ

    // tìm theo username hoặc displayName (không phân biệt hoa thường)
    const lower = name.toLowerCase();

    const matches = guild.members.cache.filter(m =>
        m.user.username.toLowerCase().includes(lower) ||
        m.displayName.toLowerCase().includes(lower)
    );

    if (matches.size === 0) return null;
    if (matches.size > 1) return "multiple";

    return matches.first();
}

// tìm user
const user = await findUserByName(info);

if (user === "multiple") {
    return interaction.editReply({
        content: "⚠️ Có nhiều người trùng tên! Vui lòng nhập rõ hơn.",
        ephemeral: true
    });
}

if (!user) {
    return interaction.editReply({
        content: "❌ Không tìm thấy người dùng với tên đó.",
        ephemeral: true
    });
}

// nếu tìm thấy 1 user → chuyển thành ping
info = `<@${user.id}>`;
    const expireHour = Number(interaction.fields.getTextInputValue("expire_hour"));
    const price = interaction.fields.getTextInputValue("price");
    const note = interaction.fields.getTextInputValue("note") || "Không có";

    // Chuẩn hóa mention ID
    const mentionMatch = info.match(/<@!?(\d+)>/);
    if (mentionMatch) info = `<@${mentionMatch[1]}>`;
    else if (/^\d{17,20}$/.test(info)) info = `<@${info}>`;

    const expireAt = Date.now() + expireHour * 60 * 60 * 1000;

    // Gửi đơn sang channel khác
    const channel = await client.channels.fetch(orderChannelId);

    // TẠO TRƯỚC ID TRONG DB
    const orderTemp = {
      product: ten,
      customerInfo: info,
      price,
      note,
      expireAt,
      status: "pending",
      channelId: orderChannelId,
      messageId: null,
      createdAt: Date.now()
    };

    const insertId = insertOrder(orderTemp);

    const embed = new EmbedBuilder()
      .setTitle(`📦 Đơn hàng: ${ten}`)
      .setColor("Blue")
      .addFields(
        { name: "👤 Khách hàng", value: info },
        { name: "💰 Giá", value: price },
        { name: "⏱ Hết hạn sau", value: `${expireHour} giờ` },
        { name: "📌 Ghi chú", value: note }
      )
      .setFooter({ text: `ID đơn hàng: ${insertId}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`accept_${insertId}`)
        .setLabel("Xác nhận")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`deny_${insertId}`)
        .setLabel("Từ chối")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger)
    );

    const sent = await channel.send({ embeds: [embed], components: [row] });

    // LƯU MESSAGE ID VÀO DB
    db.prepare(`UPDATE orders SET messageId = ? WHERE id = ?`).run(sent.id, insertId);

    scheduleExpireCheck({ ...orderTemp, id: insertId, messageId: sent.id });

    return interaction.editReply({ content: `✅ Đã tạo đơn thành công! ID: ${insertId}` });
  }


  // ================== BUTTON: ACCEPT / DENY ==================
  if (interaction.isButton()) {
    const [action, id] = interaction.customId.split("_");
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
    if (!order) return interaction.reply({ content: "❌ Không tìm thấy đơn.", ephemeral: true });

    // chỉ khách hàng được mention mới được bấm
    if (!order.customerInfo.includes(interaction.user.id))
      return interaction.reply({ content: "⚠️ Bạn không phải khách của đơn này.", ephemeral: true });

    const msg = await interaction.channel.messages.fetch(order.messageId);

    const disabledRow = new ActionRowBuilder().addComponents(
      msg.components[0].components.map(b =>
        ButtonBuilder.from(b).setDisabled(true)
      )
    );

    if (action === "accept") {
      db.prepare(`UPDATE orders SET status = 'accepted' WHERE id = ?`).run(id);

      const embed = EmbedBuilder.from(msg.embeds[0])
        .setColor("Green")
        .setFooter({ text: "Khách đã xác nhận đơn hàng" });

      await msg.edit({ embeds: [embed], components: [disabledRow] });

      return interaction.reply({ content: "✅ Bạn đã xác nhận đơn hàng.", ephemeral: true });
    }

    if (action === "deny") {
      db.prepare(`UPDATE orders SET status = 'denied' WHERE id = ?`).run(id);

      const embed = EmbedBuilder.from(msg.embeds[0])
        .setColor("Red")
        .setFooter({ text: "Khách đã từ chối đơn hàng" });

      await msg.edit({ embeds: [embed], components: [disabledRow] });

      return interaction.reply({ content: "❌ Bạn đã từ chối đơn hàng.", ephemeral: true });
    }
  }

});

client.login(token);
