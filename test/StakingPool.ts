import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import chai from 'chai'
import { ethers, network } from 'hardhat'
import { expect } from 'chai'
import { StakingPool, WeSenditToken, WeSenditToken__factory, WeStakeitToken, WeStakeitToken__factory } from "../typechain";
import { MockContract, smock } from '@defi-wonderland/smock';
import { BigNumber } from "ethers";
import { formatEther, parseEther } from "ethers/lib/utils";
import { writeFileSync } from "fs";
import { join } from "path";

chai.should();
chai.use(smock.matchers);

const getBlockTimestamp = async () => {
  const blockNum = await getBlockNumber()
  const block = await ethers.provider.getBlock(blockNum)

  return block.timestamp
}

const getBlockNumber = async () => {
  return await ethers.provider.getBlockNumber()
}

const mineBlocks = async (count: number = 1, interval: number = 3) => {
  await network.provider.send("hardhat_mine", [
    `0x${Math.ceil(count).toString(16)}`,
    `0x${interval.toString(16)}`
  ])
}

describe.only("StakingPool", function () {
  let contract: StakingPool

  let mockWsi: MockContract<WeSenditToken>
  let mockRewardToken: MockContract<WeStakeitToken>

  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let addrs: SignerWithAddress[]

  beforeEach(async function () {
    [owner, alice, bob, ...addrs] = await ethers.getSigners()

    const WeSenditToken = await smock.mock<WeSenditToken__factory>('WeSenditToken')
    mockWsi = await WeSenditToken.deploy(owner.address)

    const WeStakeitToken = await smock.mock<WeStakeitToken__factory>('WeStakeitToken')
    mockRewardToken = await WeStakeitToken.deploy()

    const StakingPool = await ethers.getContractFactory("StakingPool")
    contract = await StakingPool.deploy(mockWsi.address, mockRewardToken.address)

    await mockRewardToken.transferOwnership(contract.address)
  });

  describe("Deployment", function () {
  });

  xdescribe("Pool Factor Calculation", function () {
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

  describe('Pool Staking', function () {

    afterEach(async function () {
      await network.provider.send("hardhat_reset")
    })

    for (const entry of [
      {
        amount: parseEther('200'),
        duration: 364,
        isAutoCompoundingEnabled: true,
        shares: 40120,
        rewards: parseEther('388.903941675885320362')
      },
      {
        amount: parseEther('200'),
        duration: 182,
        isAutoCompoundingEnabled: true,
        shares: 14701,
        rewards: parseEther('142.504407940607928581')
      },
      {
        amount: parseEther('200'),
        duration: 7,
        isAutoCompoundingEnabled: true,
        shares: 426,
        rewards: parseEther('4.129438662859599863')
      },
      {
        amount: parseEther('200'),
        duration: 364,
        isAutoCompoundingEnabled: false,
        shares: 22000,
        rewards: parseEther('213.257395734533326220')
      },
      {
        amount: parseEther('200'),
        duration: 182,
        isAutoCompoundingEnabled: false,
        shares: 11000,
        rewards: parseEther('106.628697867266663110')
      },
      {
        amount: parseEther('200'),
        duration: 7,
        isAutoCompoundingEnabled: false,
        shares: 418,
        rewards: parseEther('4.051890518956133199')
      }
    ]) {
      it(`should stake given token entry (amount = ${formatEther(entry.amount)}, duration = ${entry.duration}, isAutoCompoundingEnabled = ${entry.isAutoCompoundingEnabled})`, async function () {
        // Arrange
        await mockWsi.approve(contract.address, entry.amount)
        await network.provider.send("evm_setAutomine", [false]);

        // Act
        await contract.stake(
          entry.amount,
          entry.duration,
          entry.isAutoCompoundingEnabled
        )

        await mineBlocks()

        // Assert
        const startBlock = await getBlockNumber()
        const poolEntry = await contract.poolEntry(0)
        expect(poolEntry).to.have.length(9)
        expect(poolEntry.amount).to.equal(entry.amount)
        expect(poolEntry.duration).to.equal(entry.duration)
        expect(poolEntry.shares).to.equal(entry.shares)
        expect(poolEntry.rewardDebt).to.equal(0)
        expect(poolEntry.claimedRewards).to.equal(0)
        expect(poolEntry.lastClaimedAt).to.equal(0)
        expect(poolEntry.startedAt).to.equal(await getBlockTimestamp())
        expect(poolEntry.startBlock).to.equal(await getBlockNumber())
        expect(poolEntry.isAutoCompoundingEnabled).to.equal(entry.isAutoCompoundingEnabled)

        expect(await mockRewardToken.balanceOf(owner.address)).to.equal(1)
        expect(await mockRewardToken.ownerOf(0)).to.equal(owner.address)

        expect(await contract.pendingRewards(0)).to.equal(0)

        await mineBlocks()

        const currentBlock = await getBlockNumber()
        const blockDiff = BigNumber.from(currentBlock - startBlock)
        const rewards = entry.rewards.mul(blockDiff).div(BigNumber.from(10373685))

        expect(await contract.pendingRewards(0)).to.be.closeTo(rewards, 1000000000)

        await mineBlocks(10373685, 3)

        expect(await contract.pendingRewards(0)).to.equal(entry.rewards)
      })
    }

    it(`should not earn rewards after duration exceeded`, async function () {
      // Arrange
      const amount = parseEther('200')
      const totalRewards = parseEther('388.903941675885320362')
      const duration = 364
      const isAutoCompoundingEnabled = true

      await mockWsi.approve(contract.address, amount)
      await network.provider.send("evm_setAutomine", [false]);

      // Act
      await contract.stake(
        amount,
        duration,
        isAutoCompoundingEnabled
      )

      await mineBlocks()

      // Assert
      const startBlock = await getBlockNumber()
      expect(await contract.pendingRewards(0)).to.equal(0)

      await mineBlocks()

      const currentBlock = await getBlockNumber()
      const blockDiff = BigNumber.from(currentBlock - startBlock)
      const rewards = totalRewards.mul(blockDiff).div(BigNumber.from(10373685))

      expect(await contract.pendingRewards(0)).to.be.closeTo(rewards, 1000000000)

      await mineBlocks(10373685 * 2, 3)

      expect(await contract.pendingRewards(0)).to.equal(totalRewards)
    })

    it(`should not earn rewards after duration exceeded meanwhile updatePool() was triggered`, async function () {
      // Arrange
      const amount = parseEther('200')
      const totalRewards = parseEther('388.903941675885320362')
      const duration = 364
      const isAutoCompoundingEnabled = true

      await mockWsi.approve(contract.address, amount)
      await network.provider.send("evm_setAutomine", [false]);

      // Act
      await contract.stake(
        amount,
        duration,
        isAutoCompoundingEnabled
      )

      await mineBlocks()

      // Assert
      const startBlock = await getBlockNumber()
      expect(await contract.pendingRewards(0)).to.equal(0)

      await mineBlocks()

      const currentBlock = await getBlockNumber()
      const blockDiff = BigNumber.from(currentBlock - startBlock)
      const rewards = totalRewards.mul(blockDiff).div(BigNumber.from(10373685))

      expect(await contract.pendingRewards(0)).to.be.closeTo(rewards, 1000000000)

      await mineBlocks(10373685 + (10373685 / 2))

      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, 1000000000)

      await mockWsi.approve(contract.address, parseEther('100000'))
      await contract.stake(
        parseEther('100000'),
        duration,
        isAutoCompoundingEnabled
      )

      await mineBlocks(10373685 / 2, 3)

      await contract.updatePool()
      await mineBlocks()

      console.log("bla 1")
      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, 1000000000)
      console.log("bla 2")
      expect(await contract.pendingRewards(1)).to.be.closeTo(totalRewards.div(2), 1000000000)
      console.log("bla 3")
    })

        it(`should not earn rewards after duration exceeded meanwhile updatePool() was triggered`, async function () {
      // Arrange
      const amount = parseEther('200')
      const totalRewards = parseEther('388.903941675885320362')
      const duration = 364
      const isAutoCompoundingEnabled = true

      await mockWsi.approve(contract.address, amount)
      await network.provider.send("evm_setAutomine", [false]);

      // Act
      await contract.stake(
        amount,
        duration,
        isAutoCompoundingEnabled
      )

      await mineBlocks()

      // Assert
      const startBlock = await getBlockNumber()
      expect(await contract.pendingRewards(0)).to.equal(0)

      await mineBlocks()

      const currentBlock = await getBlockNumber()
      const blockDiff = BigNumber.from(currentBlock - startBlock)
      const rewards = totalRewards.mul(blockDiff).div(BigNumber.from(10373685))

      expect(await contract.pendingRewards(0)).to.be.closeTo(rewards, 1000000000)

      await mineBlocks(10373685 + (10373685 / 2))

      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, 1000000000)

      await mockWsi.approve(contract.address, parseEther('100000'))
      await contract.stake(
        parseEther('100000'),
        duration,
        isAutoCompoundingEnabled
      )

      await mineBlocks(10373685, 3)

      await contract.updatePool()
      await mineBlocks()

      console.log("bla 1")
      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, 1000000000)
      console.log("bla 2")
      expect(await contract.pendingRewards(1)).to.be.closeTo(totalRewards.div(2), 1000000000)
      console.log("bla 3")
    })
    
    it(`should not earn rewards after duration exceeded meanwhile updatePool() was triggered`, async function () {
      // Arrange
      const amount = parseEther('200')
      const totalRewards = parseEther('388.903941675885320362')
      const duration = 364
      const isAutoCompoundingEnabled = true

      await mockWsi.approve(contract.address, amount)
      await network.provider.send("evm_setAutomine", [false]);

      // Act
      await contract.stake(
        amount,
        duration,
        isAutoCompoundingEnabled
      )

      await mineBlocks()

      // Assert
      const startBlock = await getBlockNumber()
      expect(await contract.pendingRewards(0)).to.equal(0)

      await mineBlocks()

      const currentBlock = await getBlockNumber()
      const blockDiff = BigNumber.from(currentBlock - startBlock)
      const rewards = totalRewards.mul(blockDiff).div(BigNumber.from(10373685))

      expect(await contract.pendingRewards(0)).to.be.closeTo(rewards, 1000000000)

      await mineBlocks(10373685 + (10373685 / 2))

      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, 1000000000)

      await mockWsi.approve(contract.address, parseEther('100000'))
      await contract.stake(
        parseEther('100000'),
        duration,
        isAutoCompoundingEnabled
      )

      await mockWsi.approve(contract.address, parseEther('100000'))
      await contract.stake(
        parseEther('100000'),
        duration,
        isAutoCompoundingEnabled
      )

      await mineBlocks(10373685 * 4, 3)

      await contract.updatePool()
      await mineBlocks()

      console.log("bla 1")
      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, 1000000000)
      console.log("bla 2")
      expect(await contract.pendingRewards(1)).to.be.closeTo(totalRewards.div(2), 1000000000)
      console.log("bla 3")
    })

  })

})