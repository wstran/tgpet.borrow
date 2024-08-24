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

export const transfer = async (privateKey: string, toAddress: string, balance: string, payload?: string) => {
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