'use strict';
// Blacklist2 GP bot.
// Buyer: "Buy GP" button -> form (pack, payment method, account, reference no., screenshot)
//        -> private #order-NNNN channel.
// Owner: gets a DM with the screenshot and Approve / Reject buttons.
//        Approve -> the website mints one single-use code -> the bot posts it in the buyer's
//        private channel (and DMs it). Only OWNER_ID can approve, reject or close.
const {
  Client, GatewayIntentBits, Partials, Events, ChannelType, PermissionFlagsBits, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, FileUploadBuilder,
  EmbedBuilder, AttachmentBuilder,
} = require('discord.js');
const { cfg, check } = require('./config');
const api = require('./api');
const store = require('./store');
const { cleanAccount, cleanReference, fetchProof, packLabel } = require('./checks');

const missing = check();
if (missing.length) {
  console.error(`Fill these in bot/.env first: ${missing.join(', ')}`);
  process.exit(1);
}
store.load();

const RED = 0xb3161f;
const GOLD = 0xc9a253;
const STEEL = 0x9aa1a9;
const EPHEMERAL = { flags: MessageFlags.Ephemeral };
const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`); // never log codes or references

const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });

const isOwner = (user) => user.id === cfg.ownerId;
const orderRef = (o) => `DC-${o.id}-${o.channelId.slice(-6)}`;

function orderEmbed(o, title, color) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(
      { name: 'Order', value: `#${o.id}`, inline: true },
      { name: 'Buyer', value: `<@${o.userId}>`, inline: true },
      { name: 'Pack', value: o.packLabel },
      { name: 'Paid with', value: o.method, inline: true },
      { name: 'Reference no.', value: `\`${o.reference}\``, inline: true },
      { name: 'In-game account', value: `\`${o.account}\``, inline: true },
    )
    .setTimestamp(new Date(o.createdAt));
}

function reviewButtons(o, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`b2:approve:${o.id}`).setLabel('Approve & send code').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`b2:reject:${o.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

function closeButton(o, label = 'Close order') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`b2:close:${o.id}`).setLabel(label).setStyle(ButtonStyle.Secondary),
  );
}

/** Edits the owner's review message (in DM or the log channel), if we still know where it is. */
async function updateReview(o, note, color) {
  if (!o.review) return;
  try {
    const ch = await client.channels.fetch(o.review.channelId);
    const msg = await ch.messages.fetch(o.review.messageId);
    const embed = EmbedBuilder.from(msg.embeds[0]).setColor(color).setFooter({ text: note });
    await msg.edit({ embeds: [embed], components: [reviewButtons(o, true)] });
  } catch (e) {
    log(`order ${o.id}: could not update review message (${e.code || e.name})`);
  }
}

async function toLogChannel(payload) {
  if (!cfg.logChannelId) return;
  try { await (await client.channels.fetch(cfg.logChannelId)).send(payload); } catch { /* optional */ }
}

// ---------- Slash command: post the panel ----------
async function onPanel(i) {
  if (!isOwner(i.user)) return i.reply({ content: 'Only the server owner can post the panel.', ...EPHEMERAL });
  const embed = new EmbedBuilder()
    .setColor(RED)
    .setTitle('Buy GP Codes')
    .setDescription([
      '1. Pay for a pack with any method listed above.',
      '2. Press **Buy GP** and fill in the form: pack, payment method, your in-game account, the reference number and a **screenshot of the payment**.',
      '3. A private channel opens for you. When staff confirm the payment, your **code is sent there automatically**.',
      '',
      'Staff never DM you first asking for payment.',
    ].join('\n'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('b2:buy').setLabel('Buy GP').setEmoji('💰').setStyle(ButtonStyle.Primary),
  );
  await i.channel.send({ embeds: [embed], components: [row] });
  return i.reply({ content: 'Panel posted.', ...EPHEMERAL });
}

// ---------- Buyer: open the order form ----------
async function onBuy(i) {
  const open = store.openFor(i.user.id);
  if (open) return i.reply({ content: `You already have an order waiting: <#${open.channelId}>. Please wait for staff to check it.`, ...EPHEMERAL });
  if (store.countSince(i.user.id, 24 * 3600 * 1000) >= cfg.maxOrdersPerDay) {
    return i.reply({ content: 'You have reached the order limit for today. Please try again tomorrow or open a support ticket.', ...EPHEMERAL });
  }
  let packs;
  try { packs = await api.packs(); } catch (e) {
    log(`packs unavailable (${e.message})`);
    return i.reply({ content: 'The shop is offline right now. Please try again in a few minutes.', ...EPHEMERAL });
  }
  if (!packs.length) return i.reply({ content: 'No packs are on sale right now.', ...EPHEMERAL });

  const modal = new ModalBuilder().setCustomId('b2:order').setTitle('Buy GP Code').addLabelComponents(
    new LabelBuilder().setLabel('Pack').setStringSelectMenuComponent(
      new StringSelectMenuBuilder().setCustomId('pack').setPlaceholder('Choose a pack')
        .addOptions(packs.slice(0, 25).map((p) => new StringSelectMenuOptionBuilder().setLabel(packLabel(p)).setValue(String(p.id))))),
    new LabelBuilder().setLabel('Paid with').setStringSelectMenuComponent(
      new StringSelectMenuBuilder().setCustomId('method').setPlaceholder('Payment method')
        .addOptions(cfg.methods.map((m) => new StringSelectMenuOptionBuilder().setLabel(m).setValue(m)))),
    new LabelBuilder().setLabel('In-game account name').setTextInputComponent(
      new TextInputBuilder().setCustomId('account').setStyle(TextInputStyle.Short).setMinLength(3).setMaxLength(24).setRequired(true)),
    new LabelBuilder().setLabel('Payment reference number').setTextInputComponent(
      new TextInputBuilder().setCustomId('ref').setStyle(TextInputStyle.Short).setMinLength(4).setMaxLength(40).setRequired(true)),
    new LabelBuilder().setLabel('Screenshot of the payment').setDescription('PNG, JPG or WebP, up to 8 MB').setFileUploadComponent(
      new FileUploadBuilder().setCustomId('proof').setMinValues(1).setMaxValues(1).setRequired(true)),
  );
  return i.showModal(modal);
}

// ---------- Buyer: form submitted ----------
async function onOrderSubmit(i) {
  await i.deferReply(EPHEMERAL);
  const packs = await api.packs().catch(() => []);
  const pack = packs.find((p) => String(p.id) === i.fields.getStringSelectValues('pack')[0]);
  const method = cfg.methods.find((m) => m === i.fields.getStringSelectValues('method')[0]);
  const account = cleanAccount(i.fields.getTextInputValue('account'));
  const reference = cleanReference(i.fields.getTextInputValue('ref'));
  const file = i.fields.getUploadedFiles('proof')?.first();

  const problems = [];
  if (!pack) problems.push('choose a pack');
  if (!method) problems.push('choose how you paid');
  if (!account) problems.push('in-game account: 3–24 letters, numbers, _ . or -');
  if (!reference) problems.push('reference number: 4–40 letters or numbers');
  if (!file) problems.push('attach a screenshot of the payment');
  if (problems.length) return i.editReply(`Please fix: ${problems.join('; ')}. Then press **Buy GP** again.`);

  if (store.openFor(i.user.id)) return i.editReply('You already have an order waiting for staff.');

  const proof = await fetchProof(file, cfg.maxProofBytes);
  if (proof.error) {
    const why = { too_big: 'The screenshot is larger than 8 MB.', not_image: 'The file is not a PNG, JPG or WebP image.' }[proof.error] || 'The screenshot could not be read.';
    return i.editReply(`${why} Please press **Buy GP** and try again.`);
  }

  const id = store.nextId();
  const guild = i.guild;
  const channel = await guild.channels.create({
    name: `order-${id}`,
    type: ChannelType.GuildText,
    parent: cfg.ordersCategoryId,
    topic: `GP order #${id}`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: cfg.ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageChannels] },
    ],
  });

  const order = store.put({
    id, userId: i.user.id, channelId: channel.id, packId: pack.id, packLabel: packLabel(pack), coins: pack.coins + pack.bonus,
    method, account, reference, status: 'pending_review', createdAt: new Date().toISOString(),
  });
  log(`order ${id}: created by ${i.user.id}, pack ${pack.id}`);

  const fileName = `proof-${id}.${proof.type}`;
  await channel.send({
    content: `<@${i.user.id}> thanks! Your order is with staff. Your code will be posted **here** once the payment is confirmed.`,
    embeds: [orderEmbed(order, 'Order received', STEEL).setImage(`attachment://${fileName}`)],
    files: [new AttachmentBuilder(proof.buf, { name: fileName })],
    components: [closeButton(order, 'Cancel order')],
  });

  // Owner review: DM first, the log channel if DMs are closed.
  const review = {
    content: `New GP order #${id} — check your ${method} account for this payment, then approve or reject.`,
    embeds: [orderEmbed(order, `Review order #${id}`, GOLD).setImage(`attachment://${fileName}`)],
    files: [new AttachmentBuilder(proof.buf, { name: fileName })],
    components: [reviewButtons(order)],
  };
  let sent = null;
  try { sent = await (await client.users.fetch(cfg.ownerId)).send(review); } catch { /* DMs closed */ }
  if (!sent && cfg.logChannelId) {
    try { sent = await (await client.channels.fetch(cfg.logChannelId)).send(review); } catch { /* none */ }
  }
  if (sent) store.put({ ...store.get(id), review: { channelId: sent.channelId, messageId: sent.id } });
  else log(`order ${id}: could not reach the owner (DM closed and no LOG_CHANNEL_ID)`);

  return i.editReply(`Order **#${id}** sent. Follow it here: <#${channel.id}>`);
}

// ---------- Owner: approve ----------
async function onApprove(i, id) {
  if (!isOwner(i.user)) return i.reply({ content: 'Only the owner can approve orders.', ...EPHEMERAL });
  const o = store.transition(id, ['pending_review'], 'approving');
  if (!o) return i.reply({ content: `Order #${id} is not waiting for review (status: ${store.get(id)?.status || 'unknown'}).`, ...EPHEMERAL });
  await i.deferUpdate();

  const res = await api.mint(orderRef(o), o.packId, o.userId).catch((e) => ({ error: e.name === 'TimeoutError' ? 'timeout' : 'network' }));
  if (res.error) {
    if (res.error === 'already_minted') {
      store.transition(id, ['approving'], 'error', { error: 'already_minted' });
      await updateReview(store.get(id), 'A code was already made for this order. Check Admin > Codes on the website and send it by hand.', RED);
    } else {
      store.transition(id, ['approving'], 'pending_review');
      await i.followUp({ content: `Could not create the code (${res.error}). Nothing was sent. Try **Approve** again in a minute.`, ...EPHEMERAL });
    }
    log(`order ${id}: mint failed (${res.error})`);
    return;
  }

  const delivered = { content: [
    `<@${o.userId}> ✅ **Payment confirmed!** Here is your GP code (${res.coins.toLocaleString('en-US')} GP):`,
    `\`\`\`${res.code}\`\`\``,
    `Redeem it at ${cfg.siteUrl}/recharge after logging in. Each code works **once**, keep it private.`,
  ].join('\n') };
  let posted = false;
  try { await (await client.channels.fetch(o.channelId)).send({ ...delivered, components: [closeButton(o, 'Close order')] }); posted = true; } catch { /* channel gone */ }
  let dm = false;
  try { await (await client.users.fetch(o.userId)).send(delivered); dm = true; } catch { /* DMs closed */ }

  store.transition(id, ['approving'], 'approved', { codeHint: res.hint, approvedAt: new Date().toISOString() });
  log(`order ${id}: approved, code ${res.hint} delivered (channel ${posted}, dm ${dm})`);
  const where = [posted && 'order channel', dm && 'DM'].filter(Boolean).join(' + ') || 'NOWHERE — send it by hand';
  await updateReview(store.get(id), `Approved — code ${res.hint} sent to ${where}`, GOLD);
  await toLogChannel({ content: `Order #${id} approved: ${o.packLabel}, code ${res.hint}, buyer <@${o.userId}>.` });
}

// ---------- Owner: reject (asks for a reason) ----------
async function onReject(i, id) {
  if (!isOwner(i.user)) return i.reply({ content: 'Only the owner can reject orders.', ...EPHEMERAL });
  if (store.get(id)?.status !== 'pending_review') return i.reply({ content: `Order #${id} is not waiting for review.`, ...EPHEMERAL });
  return i.showModal(new ModalBuilder().setCustomId(`b2:rejectwhy:${id}`).setTitle(`Reject order #${id}`).addLabelComponents(
    new LabelBuilder().setLabel('Reason shown to the buyer').setTextInputComponent(
      new TextInputBuilder().setCustomId('why').setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(false)
        .setPlaceholder('e.g. No payment with this reference number was received.')),
  ));
}

async function onRejectReason(i, id) {
  if (!isOwner(i.user)) return i.reply({ content: 'Only the owner can reject orders.', ...EPHEMERAL });
  const why = (i.fields.getTextInputValue('why') || '').trim() || 'The payment could not be confirmed.';
  const o = store.transition(id, ['pending_review'], 'rejected', { reason: why });
  if (!o) return i.reply({ content: `Order #${id} is not waiting for review.`, ...EPHEMERAL });
  await i.deferUpdate();
  try {
    await (await client.channels.fetch(o.channelId)).send({
      content: `<@${o.userId}> ❌ **Order #${id} was not approved.**\n> ${why.replace(/\n/g, '\n> ')}\nIf you think this is a mistake, reply here with more details or place a new order with a clearer screenshot.`,
      components: [closeButton(o, 'Close order')],
    });
  } catch { /* channel gone */ }
  log(`order ${id}: rejected`);
  await updateReview(store.get(id), 'Rejected', RED);
}

// ---------- Close / cancel ----------
async function onClose(i, id) {
  const o = store.get(id);
  if (!o) return i.reply({ content: 'Unknown order.', ...EPHEMERAL });
  const owner = isOwner(i.user);
  if (!owner && i.user.id !== o.userId) return i.reply({ content: 'This is not your order.', ...EPHEMERAL });
  if (o.status === 'approving') return i.reply({ content: 'This order is being approved right now. Try again in a moment.', ...EPHEMERAL });
  if (o.status === 'pending_review') {
    store.transition(id, ['pending_review'], 'cancelled');
    await updateReview(store.get(id), owner ? 'Closed by owner before review' : 'Cancelled by the buyer', STEEL);
  }
  store.put({ ...store.get(id), closed: true });
  await i.reply({ content: 'Closing this order channel in 5 seconds.' });
  log(`order ${id}: channel closed by ${owner ? 'owner' : 'buyer'}`);
  setTimeout(() => i.channel?.delete(`GP order #${id} closed`).catch(() => {}), 5000);
}

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand() && i.commandName === 'gp-panel') return await onPanel(i);
    if (!i.customId?.startsWith('b2:')) return;
    if (i.inGuild() && i.guildId !== cfg.guildId) return;
    const [, action, id] = i.customId.split(':');
    if (id && !/^\d{4,}$/.test(id)) return;
    if (i.isButton()) {
      if (action === 'buy') return await onBuy(i);
      if (action === 'approve') return await onApprove(i, id);
      if (action === 'reject') return await onReject(i, id);
      if (action === 'close') return await onClose(i, id);
    }
    if (i.isModalSubmit()) {
      if (action === 'order') return await onOrderSubmit(i);
      if (action === 'rejectwhy') return await onRejectReason(i, id);
    }
  } catch (e) {
    log(`interaction ${i.customId || i.commandName}: ${e.code || e.name} ${String(e.message).slice(0, 120)}`);
    const msg = { content: 'Something went wrong. Please try again, or contact staff.', ...EPHEMERAL };
    try { if (i.deferred || i.replied) await i.followUp(msg); else await i.reply(msg); } catch { /* gone */ }
  }
});

client.once(Events.ClientReady, (c) => log(`online as ${c.user.tag}; ${Object.keys(store._state().orders).length} orders on file`));
process.on('unhandledRejection', (e) => log(`unhandled: ${e && (e.code || e.name)}`));
client.login(cfg.token);
