import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import chai from 'chai'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { StakingPool } from "../typechain";
import { smock } from '@defi-wonderland/smock';
import { BigNumber } from "ethers";
import { formatEther, parseEther } from "ethers/lib/utils";
import { writeFileSync } from "fs";
import { join } from "path";

chai.should();
chai.use(smock.matchers);

const getBlockTimestamp = async () => {
  const blockNum = await ethers.provider.getBlockNumber()
  const block = await ethers.provider.getBlock(blockNum)

  return block.timestamp
}

describe.only("StakingPool", function () {
  let contract: StakingPool

  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let addrs: SignerWithAddress[]

  beforeEach(async function () {
    [owner, alice, bob, ...addrs] = await ethers.getSigners()

    const StakingPool = await ethers.getContractFactory("StakingPool");
    contract = await StakingPool.deploy()
  });

  describe("Deployment", function () {
  });

  describe("Pool Factor Calculation", function () {
    beforeEach(async function () {
    })

    for (const value of [
      {
        input: 140_000_000,
        output: parseEther('100')
      },
      {
        input: 120_000_000,
        output: parseEther('100')
      },
      {
        input: 100_000_000,
        output: parseEther('94.306372868272649')
      },
      {
        input: 75_000_000,
        output: parseEther('73.764049556927778')
      },
      {
        input: 50_000_000,
        output: parseEther('46.500669652130767')
      },
      {
        input: 25_000_000,
        output: parseEther('23.783166873633474')
      },
      {
        input: 0,
        output: parseEther('15')
      }
    ]) {
      it(`should calculate correct pool factor (balance = ${value.input})`, async function () {
        // Assert
        expect(
          await contract.poolFactor(parseEther(value.input.toString()))
        ).to.be.closeTo(value.output, 1000)
      })
    }

    xit(`should generate values for graph`, async function () {
      const arr = []

      for (let i = 0; i <= Math.floor(120_000_000 / 100000); i++) {
        const input = 120_000_000 - (100000 * i)
        const output = await contract.poolFactor(parseEther(input.toString()))
        arr.push(`${input};${Number(formatEther(output)).toFixed(2).replace('.', ',')}`)
      }

      writeFileSync(join(__dirname, 'arr.txt'), arr.reverse().join('\n'))
    })

    for (const value of [
      {
        input: 1,
        output: 15068
      },
      {
        input: 7,
        output: 213023
      },
      {
        input: 70,
        output: 2365094
      },
      {
        input: 140,
        output: 5266569
      },
      {
        input: 210,
        output: 8848911
      },
      {
        input: 280,
        output: 13306931
      },
      {
        input: 350,
        output: 18775990
      },
      {
        input: 364,
        output: 20060293
      },
      {
        input: 420,
        output: 20060293
      }
    ]) {
      it(`should calculate correct pool apy (days = ${value.input})`, async function () {
        expect(
          await contract['apy(uint256)'](value.input)
        ).to.equal(value.output)
      })
    }

    for (const value of [
      {
        input: 1,
        output: 22000
      },
      {
        input: 7,
        output: 209000
      },
      {
        input: 70,
        output: 2112000
      },
      {
        input: 140,
        output: 4224000
      },
      {
        input: 210,
        output: 6336000
      },
      {
        input: 280,
        output: 8459000
      },
      {
        input: 350,
        output: 10571000
      },
      {
        input: 364,
        output: 11000000
      },
      {
        input: 420,
        output: 11000000
      }
    ]) {
      it(`should calculate correct pool apr (days = ${value.input})`, async function () {
        expect(
          await contract['apr(uint256)'](value.input)
        ).to.equal(value.output)
      })
    }
  })

})