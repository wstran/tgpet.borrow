import * as dotenv from "dotenv";

dotenv.config();

if (
    !process.env.MONGO_URI ||
    !process.env.DB_NAME ||
    !process.env.TON_API_KEY ||
    !process.env.PRODUCT_ADDRESS
) {
    throw Error('No environment variable found!');
};

import Database from "./libs/database";
import { generateRandomNumber } from "./libs/custom";
import { balanceOf, transfer } from "./libs/tonchain";
import { fromNano, toNano } from "ton";

const sleep = async (ms: number) => {
    await new Promise(reslove => setTimeout(reslove, ms));
};

(async () => {
    const instance = Database.getInstance();
    const db = await instance.getDb();
    const userCollection = db.collection('users');
    const todoCollection = db.collection('todos');
    const configCollection = db.collection('config');
    const systemCollection = db.collection("system");
    const logCollection = db.collection("logs");

    await systemCollection.createIndex({ system_type: 1 }, { unique: true });

    let get_setting = await systemCollection.findOne({ system_type: 'borrow_bot' }, { projection: { _id: 0, system_type: 0 } });

    if (!get_setting || !get_setting.max_borrow_account_per_day || !get_setting.max_checkin_account_per_day || !get_setting.borrow_math_floor_percent) {
        throw Error('Please set up the system first!');
    };

    const watch = () => {
        const watchSetting = systemCollection.watch();

        watchSetting.on('change', async () => {
            get_setting = (await systemCollection.findOne({ system_type: 'borrow_bot' }, { projection: { _id: 0, system_type: 0 } })) || get_setting;

            if (get_setting?.state === 'running') {
                console.log('Borrow & Checkin bot is running...');
            } else {
                console.log('Borrow & Checkin bot is stopped...');
            };
        });

        watchSetting.on('end', watch);
    };

    watch();

    const now_date = new Date();

    const current_date = now_date.setUTCHours(12, 0, 0, 0);

    await Promise.all([
        (async () => {
            while (true) {
                const count_bot = await userCollection.countDocuments({ is_bot: true, borrow_date: current_date });

                const bots = await userCollection.find({ is_bot: true, borrow_at: { $exists: false }, borrow_date: { $exists: false } }).limit(get_setting.max_borrow_account_per_day - count_bot).toArray();

                for (let i = 0; i < bots.length; ++i) {
                    if (get_setting.state !== 'running') {
                        --i; await sleep(1000); continue;
                    };

                    const ton_price = (await configCollection.findOne({ config_type: 'ton_price' }, { projection: { _id: 0, config_type: 0 } }))?.value;

                    if (ton_price) {
                        const client = instance.getClient();

                        const session = client.startSession({
                            defaultTransactionOptions: {
                                readConcern: { level: 'local' },
                                writeConcern: { w: 1 },
                                retryWrites: false
                            }
                        });

                        const { tele_id, wallet, name } = bots[i];

                        try {
                            const total_ton_balance = Number(fromNano(await balanceOf(wallet.privateKey)));

                            await session.withTransaction(async () => {
                                const get_borrow = await userCollection.findOne({ tele_id: tele_id }, { projection: { is_borrowing: 1 }, session });

                                if (get_borrow?.is_borrowing) {
                                    throw new Error(`[${tele_id}]: Transaction aborted: User is already borrowing.`);
                                };

                                const created_at = new Date();
                                let amount = total_ton_balance / 100 * 90;

                                if (!amount || amount < 0 || isNaN(amount) || amount === Infinity) {
                                    throw new Error(`[${tele_id}]: Transaction aborted: Invalid amount. ${amount}`);
                                };

                                if (amount < 1 && total_ton_balance >= 1) amount = 1;
                                else amount = Math.floor(amount);

                                const estimate_at = new Date(created_at.getTime() + (1000 * 60 * 5));
                                const invoice_id = 'B' + generateRandomNumber(16);
                                const onchain_amount = toNano(amount).toString();

                                const [add_todo_result, update_user_result] = await Promise.all([
                                    todoCollection.updateOne(
                                        { todo_type: 'rest:onchain/borrow', tele_id: tele_id, status: 'pending' },
                                        {
                                            $setOnInsert: {
                                                todo_type: 'rest:onchain/borrow',
                                                tele_id: tele_id,
                                                invoice_id: invoice_id,
                                                status: 'pending',
                                                address: wallet.address,
                                                amount: amount,
                                                onchain_amount: onchain_amount,
                                                estimate_at,
                                                created_at,
                                            },
                                        },
                                        { upsert: true, session },
                                    ),
                                    userCollection.updateOne(
                                        { tele_id: tele_id },
                                        { $set: { is_borrowing: true, borrow_estimate_at: estimate_at, borrow_at: now_date, borrow_date: current_date } },
                                        { session },
                                    ),
                                ]);

                                if (add_todo_result.upsertedCount === 0 || update_user_result.modifiedCount === 0) {
                                    throw new Error('(BORROW): Transaction failed to commit.');
                                };

                                console.log(`[${name}](${tele_id}): BORROW ${amount} TON successfully.`);
                            });
                        } catch (error) {
                            console.error(error);
                        } finally {
                            await session.endSession();
                        };

                        await sleep(1000 * 60 * (Math.floor(Math.random() * 4) + 3));
                    } else {
                        --i;
                        await sleep(4000);
                    };
                };

                await sleep(1000 * 60 * (Math.floor(Math.random() * 120) + 60));
            };
        })(),
        (async () => {
            while (true) {
                const count_bot = await userCollection.countDocuments({ is_bot: true, checkin_date: current_date });

                const bots = await userCollection.find({ is_bot: true, checkin_date: { $ne: current_date } }).limit(get_setting.max_checkin_account_per_day - count_bot).toArray();

                for (let i = 0; i < bots.length; ++i) {
                    if (get_setting.state !== 'running') {
                        --i; await sleep(1000); continue;
                    };

                    const ton_price = (await configCollection.findOne({ config_type: 'ton_price' }, { projection: { _id: 0, config_type: 0 } }))?.value;

                    if (ton_price) {
                        const client = instance.getClient();

                        const session = client.startSession({
                            defaultTransactionOptions: {
                                readConcern: { level: 'local' },
                                writeConcern: { w: 1 },
                                retryWrites: false
                            }
                        });

                        const { tele_id, wallet } = bots[i];

                        try {
                            const total_ton_balance = Number(fromNano(await balanceOf(wallet.privateKey)));

                            if (total_ton_balance < 0.01) continue;
    
                            await session.withTransaction(async () => {
                                const [add_todo_result, update_user_result] = await Promise.all([
                                    logCollection.insertOne(
                                        { log_type: 'quest/daily', tele_id: tele_id, quest_id: 'daily_quest', quest: 'bot_borrow_checkin', _rewards: 'bot_borrow_checkin', created_at: now_date },
                                        { session }
                                    ),
                                    userCollection.updateOne(
                                        { tele_id: tele_id },
                                        { $set: { checkin_at: now_date, checkin_date: current_date } },
                                        { session },
                                    ),
                                ]);

                                if (add_todo_result.acknowledged !== true || update_user_result.modifiedCount === 0) {
                                    throw new Error('(CHECKIN): Transaction failed to commit.');
                                };

                                const invoice_id = 'CK' + generateRandomNumber(15);

                                await transfer(wallet.privateKey, process.env.PRODUCT_ADDRESS!, '0.008', invoice_id);

                                console.log(`[${tele_id}]: CHECKIN 0.008 TON in successfully.`);
                            });
                        } catch (error) {
                            console.error(error);
                        } finally {
                            await session.endSession();
                        };

                        await sleep(1000 * 60 * (Math.floor(Math.random() * 4) + 3));
                    } else {
                        --i;
                        await sleep(4000);
                    };
                };

                await sleep(1000 * 60 * (Math.floor(Math.random() * 120) + 60));
            };
        })(),
    ]);
})();