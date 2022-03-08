import { ethers } from "hardhat";

async function main() {
  const Token = await ethers.getContractFactory("WeSenditToken");
  const token = await Token.deploy(
    '0x0'
  );

  await token.deployed();

  console.log("WeSendit token deployed to:", token.address);

/*   await token.distributeSaleToken(
    '0x0',
    '0x0'
  )

  await token.distributeToken(
    '0x0',
    '0x0',
    '0x0',
    '0x0',
    '0x0',
    '0x0',
    '0x0',
    '0x0',
    '0x0',
    '0x0',
    '0x0'
  ) */

  console.log('Successfully distributed token')
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
