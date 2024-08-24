import axios from 'axios';
import Database from './database';

const TON_API_KEY = process.env.TON_API_KEY!;

const sleep = async (ms: number) => {
    await new Promise(reslove => setTimeout(reslove, ms));
};

export const getTransactions = async (address: string, limit: number) => {
    try {
        const api_url = `https://toncenter.com/api/v2/getTransactions?address=${address}&limit=${limit}&to_lt=0&archival=true`;

        const result = await axios.get(api_url, { headers: { 'X-API-Key': TON_API_KEY } });

        return result.data;
    } catch (error: any) {
        console.error(`getTransactions: ${error.message}`);
        return null;
    };
}

export const getTonPrice = async () => {
    try {
        const api_url = `https://api.binance.com/api/v3/ticker/price?symbol=TONUSDT`;

        const result = await axios.get(api_url);

        const price = Number(result.data?.price);

        if (!price || isNaN(price) || price < 0 || price === Infinity) return null;

        return price;
    } catch (error: any) {
        console.log(`getTonPrice: ${error.message}`);
        return null;
    };
}

class TonCenter {
    private ton_price: number;

    constructor() {
        this.ton_price = 0;

        this.updateTonPrice();
    }

    public getTonPrice() {
        return this.ton_price;
    }

    public async updateTonPrice() {
        while (true) {
            const price = await getTonPrice();

            if (price !== null) this.ton_price = price;

            try {
                const dbInstance = Database.getInstance();
                const db = await dbInstance.getDb();
                const todoCollection = db.collection('config');

                await todoCollection.updateOne(
                    { config_type: "ton_price" },
                    {
                        "$set": {
                            "value": this.ton_price,
                            "updated_at": new Date(),
                        },
                        "$setOnInsert": {
                            config_type: "ton_price"
                        },
                    },
                    { upsert: true }
                );
            } catch (error: any) {
                console.error(`updateTonPrice > db: ${error?.message}`);
            };

            await sleep(5000);
        };
    };
};

export const ton_center = new TonCenter();