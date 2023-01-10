import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import chai from 'chai'
import { ethers, network } from 'hardhat'
import { expect } from 'chai'
import { StakingPool, WeSenditToken, WeSenditToken__factory, WeStakeitToken, WeStakeitToken__factory } from "../typechain";
import { MockContract, smock } from '@defi-wonderland/smock';
import { BigNumber } from "ethers";
import { formatEther, parseEther } from "ethers/lib/utils";
import { writeFileSync } from "fs";
import { join, parse } from "path";
import moment from "moment";

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

const calculateExpectedRewards = async (contract: StakingPool, maxRewards: BigNumber, initialPoolFactor: BigNumber, duration: number, maxDuration: number) => {
  const poolBalance = await contract["poolBalance()"]()
  const poolFactor = await contract["poolFactor(uint256)"](poolBalance)

  return maxRewards
    .mul(poolFactor).div(initialPoolFactor) // current pool factor
    .mul(duration).div(maxDuration) // x days
    .mul(97).div(100) // 3% fee
}

const calculateExpectedRewardsSince = async (contract: StakingPool, maxRewards: BigNumber, initialPoolFactor: BigNumber, duration: number, maxDuration: number, previousRewards: BigNumber) => {
  const poolBalance = await contract["poolBalance()"]()
  const poolFactor = await contract["poolFactor(uint256)"](poolBalance)

  return maxRewards
    .mul(poolFactor).div(initialPoolFactor) // current pool factor
    .mul(duration).div(maxDuration) // x days
    .mul(97).div(100) // 3% fee
    .add(previousRewards)
}

const getTimeSinceStart = async (contract: StakingPool, tokenId0: number): Promise<number> => {
  const stakingStart0 = (await contract.poolEntry(tokenId0)).startedAt.toNumber()
  const now = await getBlockTimestamp()

  return now - stakingStart0
}

const getStartedAtDiff = async (contract: StakingPool, tokenId0: number, tokenId1: number): Promise<number> => {
  const stakingStart0 = (await contract.poolEntry(tokenId0)).startedAt
  const stakingStart1 = (await contract.poolEntry(tokenId1)).startedAt

  return stakingStart1.sub(stakingStart0).toNumber()
}

const getTimeSinceLastRewardTimestamp = async (contract: StakingPool): Promise<number> => {
  const now = await getBlockTimestamp()
  const lastRewardTimestamp = (await contract.lastRewardTimestamp()).toNumber()

  return now - lastRewardTimestamp
}

const increaseToSinceStakingStart = async (contract: StakingPool, tokenId: number, duration: number) => {
  const entry = await contract.poolEntry(tokenId)

  await time.increaseTo(entry.startedAt.toNumber() + duration)
}

describe.only("StakingPool", function () {
  const MIN_REWARD_PRECISION = parseEther('1')
  const INITIAL_POOL_BALANCE = parseEther('120000000')
  const INITIAL_POOL_FACTOR = parseEther('100')

  let contract: StakingPool

  let mockWsi: MockContract<WeSenditToken>
  let mockProofToken: MockContract<WeStakeitToken>

  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let addrs: SignerWithAddress[]

  beforeEach(async function () {
    [owner, alice, bob, ...addrs] = await ethers.getSigners()

    const WeSenditToken = await smock.mock<WeSenditToken__factory>('WeSenditToken')
    mockWsi = await WeSenditToken.deploy(owner.address)

    const WeStakeitToken = await smock.mock<WeStakeitToken__factory>('WeStakeitToken')
    mockProofToken = await WeStakeitToken.deploy()

    const StakingPool = await ethers.getContractFactory("StakingPool")
    contract = await StakingPool.deploy(mockWsi.address, mockProofToken.address)

    await mockProofToken.transferOwnership(contract.address)
    await mockWsi.unpause()
    await mockWsi.transfer(contract.address, INITIAL_POOL_BALANCE)
    await mockWsi.transfer(alice.address, parseEther('10000000'))
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

  xdescribe('Pool Staking', function () {

    afterEach(async function () {
      await network.provider.send("hardhat_reset")
    })

    for (const entry of [
      {
        amount: parseEther('200'),
        duration: 364,
        isAutoCompoundingEnabled: true,
        shares: 40120,
        rewards: parseEther('388.097797260273957143')
      },
      {
        amount: parseEther('200'),
        duration: 182,
        isAutoCompoundingEnabled: true,
        shares: 14701,
        rewards: parseEther('142.209015890410953240')
      },
      {
        amount: parseEther('200'),
        duration: 7,
        isAutoCompoundingEnabled: true,
        shares: 426,
        rewards: parseEther('4.120878904109588877')
      },
      {
        amount: parseEther('200'),
        duration: 364,
        isAutoCompoundingEnabled: false,
        shares: 22000,
        rewards: parseEther('212.815342465753416180')
      },
      {
        amount: parseEther('200'),
        duration: 182,
        isAutoCompoundingEnabled: false,
        shares: 11000,
        rewards: parseEther('106.407671232876708090')
      },
      {
        amount: parseEther('200'),
        duration: 7,
        isAutoCompoundingEnabled: false,
        shares: 418,
        rewards: parseEther('4.043491506849314908')
      }
    ]) {
      it(`should stake given token entry (amount = ${formatEther(entry.amount)}, duration = ${entry.duration}, isAutoCompoundingEnabled = ${entry.isAutoCompoundingEnabled})`, async function () {
        // Arrange
        await mockWsi.approve(contract.address, entry.amount)

        // Act
        await contract.stake(
          entry.amount,
          entry.duration,
          entry.isAutoCompoundingEnabled
        )

        // Assert
        const startTimestamp = await getBlockTimestamp()
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

        expect(await mockProofToken.balanceOf(owner.address)).to.equal(1)
        expect(await mockProofToken.ownerOf(0)).to.equal(owner.address)

        expect(await contract.pendingRewards(0)).to.equal(0)

        await mineBlocks(1, 10)
        const currentTimestamp = await getBlockTimestamp()
        const diff = BigNumber.from(currentTimestamp - startTimestamp)
        const rewards = entry.rewards.mul(diff).div(BigNumber.from(364 * 86400))

        expect(await contract.pendingRewards(0)).to.be.closeTo(rewards, 100000)

        await time.increaseTo(moment.unix(startTimestamp).add(364, 'days').unix())
        expect(await contract.pendingRewards(0)).to.equal(entry.rewards)
      })
    }

    it(`should not earn rewards after duration exceeded`, async function () {
      // Arrange
      const amount = parseEther('200')
      const totalRewards = parseEther('388.097797260273957143')
      const duration = 364
      const isAutoCompoundingEnabled = true

      await mockWsi.approve(contract.address, amount)

      // Act
      await contract.stake(
        amount,
        duration,
        isAutoCompoundingEnabled
      )

      // Assert
      const startTimestamp = await getBlockTimestamp()
      expect(await contract.pendingRewards(0)).to.equal(0)

      await time.increaseTo(moment.unix(startTimestamp).add(364 * 2, 'days').unix())

      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, 100000)
    })

    it(`should not earn rewards after duration exceeded meanwhile updatePool() was triggered`, async function () {
      // Arrange
      const amount = parseEther('200')
      const totalRewards = parseEther('388.097797260273957143')
      const duration = 364
      const isAutoCompoundingEnabled = true

      await mockWsi.approve(contract.address, amount)

      // Act
      await contract.stake(
        amount,
        duration,
        isAutoCompoundingEnabled
      )

      // Assert
      const startTimestamp = await getBlockTimestamp()
      expect(await contract.pendingRewards(0)).to.equal(0)

      await time.increaseTo(moment.unix(startTimestamp).add(364, 'days').unix())
      expect(await contract.pendingRewards(0)).to.equal(totalRewards)

      await mockWsi.approve(contract.address, parseEther('200'))
      await contract.stake(
        parseEther('200'),
        duration,
        isAutoCompoundingEnabled
      )

      await time.increaseTo(moment.unix(await getBlockTimestamp()).add(364 / 2, 'days').unix())
      await contract.updatePool()

      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, MIN_REWARD_PRECISION)
      expect(await contract.pendingRewards(1)).to.be.closeTo(totalRewards.div(2), MIN_REWARD_PRECISION)
    })

    it(`should not earn rewards after duration exceeded meanwhile updatePool() was triggered`, async function () {
      // Arrange
      const amount = parseEther('200')
      const totalRewards = parseEther('388.097797260273957143')
      const duration = 364
      const isAutoCompoundingEnabled = true

      await mockWsi.approve(contract.address, amount)

      // Act
      await contract.stake(
        amount,
        duration,
        isAutoCompoundingEnabled
      )

      // Assert
      expect(await contract.pendingRewards(0)).to.equal(0)

      await time.increaseTo(moment.unix(await getBlockTimestamp()).add(364 * 1.5, 'days').unix())
      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, MIN_REWARD_PRECISION)

      await mockWsi.approve(contract.address, parseEther('200'))
      await contract.stake(
        parseEther('200'),
        duration,
        isAutoCompoundingEnabled
      )

      await time.increaseTo(moment.unix(await getBlockTimestamp()).add(364 * 0.75, 'days').unix())
      await contract.updatePool()

      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, MIN_REWARD_PRECISION)
      expect(await contract.pendingRewards(1)).to.be.closeTo(totalRewards.mul(3).div(4), MIN_REWARD_PRECISION)
    })

    it(`should not earn rewards after duration exceeded meanwhile updatePool() was triggered`, async function () {
      // Arrange
      const amount = parseEther('200')
      const totalRewards = parseEther('388.097797260273957143')
      const duration = 364
      const isAutoCompoundingEnabled = true

      await mockWsi.approve(contract.address, amount)

      // Act
      await contract.stake(
        amount,
        duration,
        isAutoCompoundingEnabled
      )

      // Assert
      expect(await contract.pendingRewards(0)).to.equal(0)

      await time.increaseTo(moment.unix(await getBlockTimestamp()).add(364 * 0.75, 'days').unix())

      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards.mul(3).div(4), MIN_REWARD_PRECISION)

      await time.increaseTo(moment.unix(await getBlockTimestamp()).add(364 * 1.5, 'days').unix())

      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, MIN_REWARD_PRECISION)

      await mockWsi.approve(contract.address, parseEther('100000'))
      await contract.stake(
        parseEther('100000'),
        duration,
        isAutoCompoundingEnabled
      )

      await time.increaseTo(moment.unix(await getBlockTimestamp()).add(364 * 0.5, 'days').unix())
      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, MIN_REWARD_PRECISION)

      await mockWsi.approve(contract.address, parseEther('100000'))
      await contract.stake(
        parseEther('100000'),
        duration,
        isAutoCompoundingEnabled
      )

      await time.increaseTo(moment.unix(await getBlockTimestamp()).add(364 * 100, 'days').unix())

      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, MIN_REWARD_PRECISION)
      // expect(await contract.pendingRewards(1)).to.be.closeTo(totalRewards.div(2), MIN_REWARD_PRECISION)
    })

    xit(`should not earn rewards after duration exceeded meanwhile updatePool() was triggered`, async function () {
      // Arrange
      const amount = parseEther('200')
      const totalRewards = parseEther('388.097797260273957143')
      const duration = 364
      const isAutoCompoundingEnabled = true

      await mockWsi.approve(contract.address, amount)

      // Act
      await contract.stake(
        amount,
        duration,
        isAutoCompoundingEnabled
      )

      // Assert
      expect(await contract.pendingRewards(0)).to.equal(0)

      await time.increaseTo(moment.unix(await getBlockTimestamp()).add(364 * 0.5, 'days').unix())

      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards.mul(2).div(4), MIN_REWARD_PRECISION)

      for (let i = 0; i < 1000; i++) {
        await mockWsi.approve(contract.address, parseEther('10'))
        await contract.stake(
          parseEther('10'),
          duration,
          isAutoCompoundingEnabled
        )

        await time.increaseTo(moment.unix(await getBlockTimestamp()).add(0.01 * (364 * (i + 1)), 'days').unix())
      }

      expect(await contract.pendingRewards(0)).to.be.closeTo(totalRewards, MIN_REWARD_PRECISION)
      // expect(await contract.pendingRewards(1)).to.be.closeTo(totalRewards.div(2), MIN_REWARD_PRECISION)
    })

  })

  xit('Pool Balance correct', async function () {
    // Assert initial state
    expect(await contract.currentPoolFactor()).to.equal(INITIAL_POOL_FACTOR)
    expect(await contract['poolBalance()']()).to.equal(INITIAL_POOL_BALANCE)

    // Calculate max. possible rewards
    const initialApr = await contract["apr(uint256)"](364)
    const maxRewards = parseEther('1000000').mul(initialApr).div(1e7)

    // Stake token inside pool
    await mockWsi.connect(alice).approve(contract.address, parseEther('1000000'))
    await contract.connect(alice).stake(
      parseEther('1000000'),
      364,
      false
    )

    await network.provider.send("evm_setAutomine", [
      false
    ])

    // Assert
    const poolEntry = await contract.poolEntry(0)
    const stakingStart = poolEntry.startedAt.toNumber()
    const calculatedRewards = maxRewards.mul(24 * 60 * 60).div(364 * 24 * 60 * 60)
    const calculatedFee = calculatedRewards.mul(3).div(100)

    expect(await contract.currentPoolFactor()).to.equal(INITIAL_POOL_FACTOR)
    expect(await contract['poolBalance()']()).to.equal(INITIAL_POOL_BALANCE)

    await time.increaseTo(moment.unix(stakingStart).add(1, 'days').unix())

    const firstPoolFactor = await contract["poolFactor()"]()
    expect(firstPoolFactor).to.equal(parseEther('99.999991826480250200'))
    expect(await contract.pendingRewards(0)).to.be.closeTo(calculatedRewards.mul(firstPoolFactor).div(parseEther('100')).sub(calculatedFee), MIN_REWARD_PRECISION)
    expect(await contract['poolBalance()']()).to.be.closeTo(INITIAL_POOL_BALANCE.sub(calculatedRewards.mul(firstPoolFactor).div(parseEther('100'))), MIN_REWARD_PRECISION)

    await time.increaseTo(moment.unix(stakingStart).add(364, 'days').unix())

    const secondPoolFactor = await contract["poolFactor()"]()
    expect(secondPoolFactor).to.equal(parseEther('99.982232766916152200'))
    expect(await contract.pendingRewards(0)).to.be.closeTo(maxRewards.mul(secondPoolFactor).div(parseEther('100')).mul(97).div(100), MIN_REWARD_PRECISION)
    expect(await contract['poolBalance(uint256)'](secondPoolFactor)).to.be.closeTo(INITIAL_POOL_BALANCE.sub(maxRewards.mul(secondPoolFactor).div(parseEther('100'))), MIN_REWARD_PRECISION)
  })

  describe.only('Rewards', async function () {
    it('should calculate correct rewards (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('2006029.3')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Assert

      // Day 0
      expect(await contract.pendingRewards(0)).to.equal(0)

      // Day 1 -> 364
      for (let i = 1; i <= 364; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, i * 86400, 31449600),
          MIN_REWARD_PRECISION
        )
      }

      // Day 364
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
        MIN_REWARD_PRECISION
      )

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct rewards with multiple stakers (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('2006029.3')

      for (let i = 0; i < 2; i++) {
        // Arrange
        await mockWsi.connect(alice).approve(contract.address, amount)

        // Act & Assert
        await contract.connect(alice).stake(
          amount,
          364,
          true
        )
      }

      // Assert

      // Day 0
      const startDiff = await getStartedAtDiff(contract, 0, 1)

      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, startDiff, 31449600),
        MIN_REWARD_PRECISION
      )
      expect(await contract.pendingRewards(1)).to.equal(0)

      // Day 1 -> 364
      for (let i = 1; i <= 364; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, i * 86400, 31449600),
          MIN_REWARD_PRECISION
        )

        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, (i * 86400) - startDiff, 31449600),
          MIN_REWARD_PRECISION
        )
      }

      // Day 364
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
        MIN_REWARD_PRECISION
      )

      expect(await contract.pendingRewards(1)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 - startDiff, 31449600),
        MIN_REWARD_PRECISION
      )

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
          MIN_REWARD_PRECISION
        )

        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 - startDiff, 31449600),
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct rewards with multiple delayed stakers (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('2006029.3')
      const delay = 43200

      // First Staker
      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Delay
      await time.increase(delay)

      // Second Staker
      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Snapshot rewards before second staker staked (pool update)
      const rewardsBeforeSecondStaker = await contract.pendingRewards(0)
      const timeSinceStart = await getTimeSinceStart(contract, 0)
      expect(rewardsBeforeSecondStaker).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, timeSinceStart, 31449600),
        MIN_REWARD_PRECISION
      )

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Assert

      // Day 0
      const startDiff = await getStartedAtDiff(contract, 0, 1)
      const timeSinceSecondStart = await getTimeSinceStart(contract, 1)

      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, timeSinceSecondStart, 31449600, rewardsBeforeSecondStaker),
        MIN_REWARD_PRECISION
      )
      expect(await contract.pendingRewards(1)).to.equal(0)

      // Day 1 -> 364
      for (let i = 1; i <= 364; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, (i * 86400) - startDiff, 31449600, rewardsBeforeSecondStaker),
          MIN_REWARD_PRECISION
        )

        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, (i * 86400) - startDiff, 31449600),
          MIN_REWARD_PRECISION
        )
      }

      // Day 364
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 - startDiff, 31449600, rewardsBeforeSecondStaker),
        MIN_REWARD_PRECISION
      )

      expect(await contract.pendingRewards(1)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 - startDiff, 31449600),
        MIN_REWARD_PRECISION
      )

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 - startDiff, 31449600, rewardsBeforeSecondStaker),
          MIN_REWARD_PRECISION
        )

        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct rewards with unstake pre-staking (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('2006029.3')

      // First Staker
      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Delay
      await time.increase(31449600)

      // Second Staker
      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Snapshot rewards before second staker staked (pool update)
      const rewardsBeforeSecondStaker = await contract.pendingRewards(0)
      expect(rewardsBeforeSecondStaker).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
        MIN_REWARD_PRECISION
      )

      // Unstake
      await contract.connect(alice).unstake(0)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Assert

      // Day 0
      expect(await contract.pendingRewards(0)).to.equal(0)
      expect(await contract.pendingRewards(1)).to.equal(0)

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.equal(0)
        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, (i * 86400) - 31449600, 31449600),
          MIN_REWARD_PRECISION
        )
      }

      // Day 728
      expect(await contract.pendingRewards(0)).to.equal(0)
      expect(await contract.pendingRewards(1)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
        MIN_REWARD_PRECISION
      )

      // Day 729 -> 1093
      for (let i = 729; i <= 1093; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.equal(0)
        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct rewards with unstake mid-staking (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('2006029.3')

      // First Staker
      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Delay
      await increaseToSinceStakingStart(contract, 0, 31449600 / 2)

      // Second Staker
      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Snapshot rewards of first staker before update
      const rewardsBeforeSecondStaker = await contract.pendingRewards(0)
      const timeSinceStakingStart = await getTimeSinceStart(contract, 0)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Delay
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Assert
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 - timeSinceStakingStart, 31449600, rewardsBeforeSecondStaker),
        MIN_REWARD_PRECISION
      )

      // Unstake
      await contract.connect(alice).unstake(0)

      // Snapshot rewards of second staker right after unstake
      const rewardsAfterUnstake = await contract.pendingRewards(1)
      const timeSinceUnstake = await getTimeSinceLastRewardTimestamp(contract)

      // Assert

      // Day 0
      expect(await contract.pendingRewards(0)).to.equal(0)
      expect(await contract.pendingRewards(1)).to.be.closeTo(
        await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, timeSinceUnstake, 31449600, rewardsAfterUnstake),
        MIN_REWARD_PRECISION
      )

      // Day 182 -> 364
      for (let i = 182; i <= 364; i++) {
        await increaseToSinceStakingStart(contract, 1, i * 86400)
        const sinceUpdate = await getTimeSinceLastRewardTimestamp(contract)

        expect(await contract.pendingRewards(0)).to.equal(0)
        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, sinceUpdate, 31449600, rewardsAfterUnstake),
          MIN_REWARD_PRECISION
        )
      }

      // Day 365
      const sinceUpdate = await getTimeSinceLastRewardTimestamp(contract)
      expect(await contract.pendingRewards(0)).to.equal(0)
      expect(await contract.pendingRewards(1)).to.be.closeTo(
        await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, sinceUpdate, 31449600, rewardsAfterUnstake),
        MIN_REWARD_PRECISION
      )

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 1, i * 86400)

        expect(await contract.pendingRewards(0)).to.equal(0)
        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, sinceUpdate, 31449600, rewardsAfterUnstake),
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct rewards with pool update before staking (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('2006029.3')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Trigger pool update
      await contract.updatePool()

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Assert

      // Day 0
      expect(await contract.pendingRewards(0)).to.equal(0)

      // Day 1 -> 364
      for (let i = 1; i <= 364; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, i * 86400, 31449600),
          MIN_REWARD_PRECISION
        )
      }

      // Day 364
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
        MIN_REWARD_PRECISION
      )

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct rewards with pool update mid-staking (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('2006029.3')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Assert

      // Day 0
      expect(await contract.pendingRewards(0)).to.equal(0)

      // Day 1 -> 182
      for (let i = 1; i <= 182; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, i * 86400, 31449600),
          MIN_REWARD_PRECISION
        )
      }

      // Trigger pool update
      const rewardsBeforeUpdate = await contract.pendingRewards(0)
      await contract.updatePool();

      // Day 183 -> 364
      for (let i = 183; i <= 364; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        const expectedRewardsAfterUpdate = await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, (i - 182) * 86400, 31449600)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          rewardsBeforeUpdate.add(expectedRewardsAfterUpdate),
          MIN_REWARD_PRECISION
        )
      }

      // Day 364
      const expectedRewardsAfterUpdate = await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 / 2, 31449600)
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        rewardsBeforeUpdate.add(expectedRewardsAfterUpdate),
        MIN_REWARD_PRECISION
      )

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        const expectedRewardsAfterUpdate = await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 / 2, 31449600)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          rewardsBeforeUpdate.add(expectedRewardsAfterUpdate),
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct rewards with pool update after staking (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('2006029.3')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Assert

      // Day 0
      expect(await contract.pendingRewards(0)).to.equal(0)

      // Day 1 -> 364
      for (let i = 1; i <= 364; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, i * 86400, 31449600),
          MIN_REWARD_PRECISION
        )
      }

      // Day 364
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
        MIN_REWARD_PRECISION
      )

      // Trigger pool update
      const rewardsBeforeUpdate = await contract.pendingRewards(0)
      await contract.updatePool();

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          rewardsBeforeUpdate,
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct rewards with pool update delayed after staking (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('2006029.3')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Assert

      // Day 0
      expect(await contract.pendingRewards(0)).to.equal(0)

      // Day 1 -> 364
      for (let i = 1; i <= 364; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, i * 86400, 31449600),
          MIN_REWARD_PRECISION
        )
      }

      // Day 364
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
        MIN_REWARD_PRECISION
      )

      // Save final rewards for comparison
      const rewardsBeforeUpdate = await contract.pendingRewards(0)

      // Day 365
      await increaseToSinceStakingStart(contract, 0, 365 * 86400)

      // Trigger pool update
      await contract.updatePool();

      // Day 366 -> 728
      for (let i = 366; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          rewardsBeforeUpdate,
          MIN_REWARD_PRECISION.mul(10)
        )
      }
    })

    it('should calculate correct rewards with multiple pool update before staking (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('2006029.3')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Trigger pool update
      await contract.updatePool()
      await contract.updatePool()

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Assert

      // Day 0
      expect(await contract.pendingRewards(0)).to.equal(0)

      // Day 1 -> 364
      for (let i = 1; i <= 364; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, i * 86400, 31449600),
          MIN_REWARD_PRECISION
        )
      }

      // Day 364
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
        MIN_REWARD_PRECISION
      )

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct rewards with multiple pool updates mid-staking (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('2006029.3')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Assert

      // Day 0
      expect(await contract.pendingRewards(0)).to.equal(0)

      // Day 1 -> 182
      for (let i = 1; i <= 182; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, i * 86400, 31449600),
          MIN_REWARD_PRECISION
        )
      }

      // Trigger pool update
      const rewardsBeforeFirstUpdate = await contract.pendingRewards(0)
      await contract.updatePool();

      // Day 183 -> 273
      for (let i = 183; i <= 273; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        const expectedRewardsAfterUpdate = await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, (i - 182) * 86400, 31449600)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          rewardsBeforeFirstUpdate.add(expectedRewardsAfterUpdate),
          MIN_REWARD_PRECISION
        )
      }

      // Trigger pool update
      const rewardsBeforeSecondUpdate = await contract.pendingRewards(0)
      await contract.updatePool();

      // Day 183 -> 273
      for (let i = 274; i <= 364; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        const expectedRewardsAfterUpdate = await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, (i - 273) * 86400, 31449600)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          rewardsBeforeSecondUpdate.add(expectedRewardsAfterUpdate),
          MIN_REWARD_PRECISION
        )
      }

      // Day 364
      const expectedRewardsAfterUpdate = await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 / 4, 31449600)
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        rewardsBeforeSecondUpdate.add(expectedRewardsAfterUpdate),
        MIN_REWARD_PRECISION
      )

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        const expectedRewardsAfterUpdate = await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 / 4, 31449600)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          rewardsBeforeSecondUpdate.add(expectedRewardsAfterUpdate),
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct rewards with multiple pool update after staking (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('2006029.3')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Assert

      // Day 0
      expect(await contract.pendingRewards(0)).to.equal(0)

      // Day 1 -> 364
      for (let i = 1; i <= 364; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, i * 86400, 31449600),
          MIN_REWARD_PRECISION
        )
      }

      // Day 364
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
        MIN_REWARD_PRECISION
      )

      // Trigger pool update
      const rewardsBeforeUpdate = await contract.pendingRewards(0)
      await contract.updatePool()
      await contract.updatePool()

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          rewardsBeforeUpdate,
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct rewards with multiple pool update delayed after staking (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('2006029.3')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Assert

      // Day 0
      expect(await contract.pendingRewards(0)).to.equal(0)

      // Day 1 -> 364
      for (let i = 1; i <= 364; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, i * 86400, 31449600),
          MIN_REWARD_PRECISION
        )
      }

      // Day 364
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
        MIN_REWARD_PRECISION
      )

      // Save final rewards for comparison
      const rewardsBeforeUpdate = await contract.pendingRewards(0)

      // Day 365
      await increaseToSinceStakingStart(contract, 0, 365 * 86400)

      // Trigger pool update
      await contract.updatePool();

      // Day 366 -> 728
      for (let i = 366; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          rewardsBeforeUpdate,
          MIN_REWARD_PRECISION.mul(10)
        )
      }

      // Trigger pool update
      await contract.updatePool()

      // Day 729 -> 1092
      for (let i = 729; i <= 1092; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          rewardsBeforeUpdate,
          MIN_REWARD_PRECISION.mul(10)
        )
      }
    })
  })

  describe('Bla', async function () {
    it('should unstake token', async function () {
      const amount = parseEther('1000000')
      const maxRewards = parseEther('1100000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        false
      )

      // Skip reward period
      await increaseToSinceStakingStart(contract, 0, 259200)

      // Check if pending rewards are matching
      const pendingRewards = await contract.pendingRewards(0)
      expect(pendingRewards).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 259200, 31449600),
        MIN_REWARD_PRECISION
      )

      // Claim rewards
      const initialBalance = await mockWsi.balanceOf(alice.address)
      expect(await mockWsi.balanceOf(alice.address)).to.equal(initialBalance)
      await contract.connect(alice).claimRewards(0)
      expect(await mockWsi.balanceOf(alice.address)).to.be.closeTo(
        initialBalance.add(pendingRewards),
        MIN_REWARD_PRECISION
      )

      expect(await contract.pendingRewards(0)).to.equal(0)

      const entry = await contract.poolEntry(0)
      expect(entry.claimedRewards).to.be.closeTo(
        pendingRewards,
        MIN_REWARD_PRECISION
      )
      expect(entry.lastClaimedAt).to.equal(await getBlockTimestamp())

      await mineBlocks(1, 1)

      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 1, 31449600),
        MIN_REWARD_PRECISION
      )
    })
  })

  describe('Stake', async function () {
    it('should successfully stake (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await expect(contract.connect(alice).stake(
        amount,
        364,
        true
      )).not.to.be.reverted

      // Assert
      expect(await mockProofToken.balanceOf(alice.address)).to.equal(1)
      expect(await mockProofToken.ownerOf(0)).to.equal(alice.address)

      const entry = await contract.poolEntry(0)
      expect(entry).to.have.length(9)
      expect(entry.amount).to.equal(amount)
      expect(entry.duration).to.equal(364)
      expect(entry.shares).to.equal(200602930)
      expect(entry.rewardDebt).to.equal(0)
      expect(entry.claimedRewards).to.equal(0)
      expect(entry.lastClaimedAt).to.equal(await getBlockTimestamp())
      expect(entry.startedAt).to.equal(await getBlockTimestamp())
      expect(entry.isUnstaked).to.be.false
      expect(entry.isAutoCompoundingEnabled).to.be.true
    })

    it('should successfully stake (auto-compounding = false)', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await expect(contract.connect(alice).stake(
        amount,
        364,
        false
      )).not.to.be.reverted

      // Assert
      expect(await mockProofToken.balanceOf(alice.address)).to.equal(1)
      expect(await mockProofToken.ownerOf(0)).to.equal(alice.address)

      const entry = await contract.poolEntry(0)
      expect(entry).to.have.length(9)
      expect(entry.amount).to.equal(amount)
      expect(entry.duration).to.equal(364)
      expect(entry.shares).to.equal(110000000)
      expect(entry.rewardDebt).to.equal(0)
      expect(entry.claimedRewards).to.equal(0)
      expect(entry.lastClaimedAt).to.equal(await getBlockTimestamp())
      expect(entry.startedAt).to.equal(await getBlockTimestamp())
      expect(entry.isUnstaked).to.be.false
      expect(entry.isAutoCompoundingEnabled).to.be.false
    })

    it('should successfully stake multiple times (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')

      for (let i = 0; i < 2; i++) {
        // Arrange
        await mockWsi.connect(alice).approve(contract.address, amount)

        // Act & Assert
        await expect(contract.connect(alice).stake(
          amount,
          364,
          true
        )).not.to.be.reverted
      }

      // Assert
      expect(await mockProofToken.balanceOf(alice.address)).to.equal(2)
      expect(await mockProofToken.ownerOf(0)).to.equal(alice.address)
      expect(await mockProofToken.ownerOf(1)).to.equal(alice.address)

      const firstEntry = await contract.poolEntry(0)
      expect(firstEntry).to.have.length(9)
      expect(firstEntry.shares).to.equal(200602930)

      const secondEntry = await contract.poolEntry(0)
      expect(secondEntry).to.have.length(9)
      expect(secondEntry.shares).to.equal(200602930)
    })

    it('should successfully stake multiple times (auto-compounding = false)', async function () {
      const amount = parseEther('1000000')

      for (let i = 0; i < 2; i++) {
        // Arrange
        await mockWsi.connect(alice).approve(contract.address, amount)

        // Act & Assert
        await expect(contract.connect(alice).stake(
          amount,
          364,
          false
        )).not.to.be.reverted
      }

      // Assert
      expect(await mockProofToken.balanceOf(alice.address)).to.equal(2)
      expect(await mockProofToken.ownerOf(0)).to.equal(alice.address)
      expect(await mockProofToken.ownerOf(1)).to.equal(alice.address)

      const firstEntry = await contract.poolEntry(0)
      expect(firstEntry).to.have.length(9)
      expect(firstEntry.shares).to.equal(110000000)

      const secondEntry = await contract.poolEntry(0)
      expect(secondEntry).to.have.length(9)
      expect(secondEntry.shares).to.equal(110000000)
    })

    it('should fail to stake if duration is below min. duration', async function () {
      await expect(contract.connect(alice).stake(
        parseEther('1000000'),
        365,
        false
      )).to.be.revertedWith('Staking Pool: Invalid staking duration')
    })

    it('should fail to stake if duration exceeds max. duration', async function () {
      await expect(contract.connect(alice).stake(
        parseEther('1000000'),
        6,
        false
      )).to.be.revertedWith('Staking Pool: Invalid staking duration')
    })

    it('should fail to stake if duration is no full week', async function () {
      await expect(contract.connect(alice).stake(
        parseEther('1000000'),
        8,
        false
      )).to.be.revertedWith('Staking Pool: Staking duration needs to be a full week')
    })

    it('should fail to stake if missing approval', async function () {
      await expect(contract.connect(alice).stake(
        parseEther('1000000'),
        364,
        false
      )).to.be.revertedWith('Staking Pool: Amount exceeds allowance')
    })

    it('should fail to stake amount is higher max. staking amount (pool balance > 80% of initial balance)', async function () {
      // Arrange
      await mockWsi.connect(alice).approve(contract.address, parseEther('1000001'))

      // Act & Assert
      await expect(contract.connect(alice).stake(
        parseEther('1000001'),
        364,
        false
      )).to.be.revertedWith('Staking Pool: Max. staking amount exceeded')
    })

    it('should fail to stake amount is higher max. staking amount (pool balance <= 80% of initial balance)', async function () {
      // Arrange

      // Drain 20% of pool balance
      await contract.emergencyWithdrawToken(mockWsi.address, parseEther('24000000'))

      await mockWsi.connect(alice).approve(contract.address, parseEther('960001'))

      // Act & Assert
      await expect(contract.connect(alice).stake(
        parseEther('960001'),
        364,
        false
      )).to.be.revertedWith('Staking Pool: Max. staking amount exceeded')
    })
  })

})