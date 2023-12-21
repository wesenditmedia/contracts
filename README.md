# <img src="https://wesendit.io/wp-content/uploads/2022/04/cropped-WSI_Favicon-192x192.png" width="20px" height="20px"></img> WeSendit Smart Contracts 🚀

This repository contains a set of smart contracts used by WeSendit.

## Deployment

```shell
npx hardhat run --network bscTestnet scripts/deploy.ts
```

## Smart Contracts

| Sourcefile | Description |
|---|---|
| [WeSenditToken.sol](contracts/WeSenditToken.sol) | WeSendit ERC20 Token Contract, with small modifications to support fee reflection using Dynamic Fee Manager.
| [DynamicFeeManager.sol](contracts/DynamicFeeManager.sol) | Dynamic Fee Manager, able to dynamically add or remove fees for reflection on transactions.
| [EmergencyGuard.sol](contracts/EmergencyGuard.sol) | Emergency Guard, provides emergency ETH / token withdrawal functions from contract address.
| [StakingPool.sol](contracts/StakingPool.sol) | WeSendit Staking Pool Contract.
| [WeStakeitToken.sol](contracts/WeStakeitToken.sol) | WeSendit Staking Pool Proof NFT.
| [VestingWallet.sol](contracts/VestingWallet.sol) | WeSendit Vesting Wallet, based on OpenZeppelin Vesting Wallet.
| [TokenVault.sol](contracts/TokenVault.sol) | WeSendit Token Vault, used to lock token on it.
| [MultiVestingWallet.sol](contracts/MultiVestingWallet.sol) | WeSendit Multi Vesting Wallet, used to vest token for multiple beneficiaries.
| [PaymentProcessor.sol](contracts/PaymentProcessor.sol) | WeSendit 3.0 Payment Processor Smart Contract, used for web3 payments.
| [RewardDistributor.sol](contracts/RewardDistributor.sol) | WeSendit 3.0 Reward Distributor Smart Contract, used for web3 activity rewards.

## Audits

| Report | Audit Date | Organization |
|---|---|---|
| [WeSendit_SCAudit_Report_Hacken_io.pdf](audits/WeSendit_SCAudit_Report_Hacken_io.pdf) | 20th Oct. 2022 | [Hacken](https://hacken.io)
| [WeSendit_SCAudit_Report_Solidproof_io.pdf](audits/WeSendit_SCAudit_Report_Solidproof_io.pdf) | 22nd Oct. 2022 | [Solidproof](https://solidproof.io)
| [SmartContract_Audit_Solidproof_WesendIt_PaymentDistributor.pdf](audits/SmartContract_Audit_Solidproof_WesendIt_PaymentDistributor.pdf) | 21st Dec. 2022 | [Solidproof](https://solidproof.io)
