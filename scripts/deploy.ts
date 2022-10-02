import { ethers } from "hardhat";

async function main() {
  const WeSenditToken = await ethers.getContractFactory("WeSenditToken");
  const weSenditToken = await WeSenditToken.deploy(
    '0x000000000000000000000000000000000000dEaD'
  );

  console.log("WeSenditToken deployed to:", weSenditToken.address);

  const DynamicFeeManager = await ethers.getContractFactory('DynamicFeeManager')
  const dynamicFeeManager = await DynamicFeeManager.deploy(weSenditToken.address)

  console.log("DynamicFeeManager deployed to:", dynamicFeeManager.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
