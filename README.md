# <img src="https://wesendit.io/wp-content/uploads/2022/04/cropped-WSI_Favicon-192x192.png" width="20px" height="20px"></img> WeSendit Smart Contracts 🚀

> This repository contains the core smart contracts used by the WeSendit crypto project.

## Deployment

```shell
npx hardhat run --network bscTestnet scripts/deploy.ts
```

## Included Smart Contracts

| Sourcefile | Description |
|---|---|
| [WeSenditToken.sol](contracts/WeSenditToken.sol) | WeSendit ERC20 Token Contract, with small modifications to support fee reflection using Dynamic Fee Manager.
| [DynamicFeeManager.sol](contracts/DynamicFeeManager.sol) | Dynamic Fee Manager, able to dynamically add or remove fees for reflection on transactions.

## Audits

| Report | Audit Date | Organization |
|---|---|---|
| [WeSendit_SCAudit_Report_Hacken_io.pdf](WeSendit_SCAudit_Report_Hacken_io.pdf) | 20th Oct. 2022 | [Hacken](https://hacken.io)
| [WeSendit_SCAudit_Report_Solidproof_io.pdf](WeSendit_SCAudit_Report_Solidproof_io.pdf) | 22th Oct. 2022 | [Solidproof](https://solidproof.io)
