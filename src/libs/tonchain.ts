import { TonClient, internal, SendMode, WalletContractV4 } from "ton";
import nacl from "tweetnacl";
import { Buffer } from "buffer";

const client = new TonClient({
  endpoint: 'https://toncenter.com/api/v2/jsonRPC',
  apiKey: process.env.TON_API_KEY
});

export const balanceOf = async (privateKey: string) => {
  const { publicKey } = nacl.sign.keyPair.fromSecretKey(Buffer.from(privateKey, 'hex') as unknown as Uint8Array);

  const workchain = 0;
  const wallet = WalletContractV4.create({ workchain, publicKey: Buffer.from(publicKey) });
  const contract = client.open(wallet);

  return await contract.getBalance();
};

const transfer = async (privateKey: string, toAddress: string, balance: string, payload?: string) => {
  const { secretKey, publicKey } = nacl.sign.keyPair.fromSecretKey(Buffer.from(privateKey, 'hex') as unknown as Uint8Array);

  const workchain = 0;
  const wallet = WalletContractV4.create({ workchain, publicKey: Buffer.from(publicKey) });
  const contract = client.open(wallet);
  const seqno: number = await contract.getSeqno();

  const transfer = contract.createTransfer({
    seqno,
    secretKey: Buffer.from(secretKey),
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: [internal({
      value: balance.toString(),
      to: toAddress,
      body: payload,
    })]
  });

  await client.sendExternalMessage(wallet, transfer);
};

class TransferQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing: boolean = false;

  public async addToQueue(transferFunc: (retryCount: number) => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        let retryCount = 0;
        while (retryCount < 4) {
          try {
            await transferFunc(retryCount);
            resolve();
            return;
          } catch (error) {
            retryCount++;
            if (retryCount >= 4) {
              console.error("Transfer failed after 4 retries:", error);
              reject(error);
              return;
            } else {
              console.error(`Transfer failed, retrying (${retryCount}/4) in 5 seconds:`, error);
              await new Promise(r => setTimeout(r, 5000));
            };
          };
        };
      });

      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const transferFunc = this.queue.shift();
      if (transferFunc) {
        try {
          await transferFunc();
        } catch (error) {
          console.error("Transfer failed and will not retry further:", error);
        };
      };
    };
    this.processing = false;
  };
}

const transferQueue = new TransferQueue();

export const addTransferToQueue = async (privateKey: string, toAddress: string, balance: string, payload?: string): Promise<void> => {
  await transferQueue.addToQueue(async () => {
    await transfer(privateKey, toAddress, balance, payload);
  });
};