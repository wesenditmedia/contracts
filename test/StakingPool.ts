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

const calculateExpectedRewards = async (contract: StakingPool, maxRewards: BigNumber, initialPoolFactor: BigNumber, duration: number, maxDuration: number) => {
  const poolFactor = await contract["poolFactor()"]()

  return maxRewards
    .mul(poolFactor).div(initialPoolFactor) // current pool factor
    .mul(duration).div(maxDuration) // x days
    .mul(97).div(100) // 3% fee
}

const calculateExpectedRewardsSince = async (contract: StakingPool, maxRewards: BigNumber, initialPoolFactor: BigNumber, duration: number, maxDuration: number, previousRewards: BigNumber) => {
  const poolFactor = await contract["poolFactor()"]();

  return maxRewards
    .mul(poolFactor).div(initialPoolFactor) // current pool factor
    .mul(duration).div(maxDuration) // x days
    .mul(97).div(100) // 3% fee
    .add(previousRewards)
}

const minRewardPrecision = (days: number, offset?: number): BigNumber => {
  let minRewards
  const daysOffset = offset || 0
  const realDays = days + daysOffset

  if (realDays > 728) {
    minRewards = 1 * realDays * 30
  } else if (realDays > 365) {
    minRewards = 1 * realDays * 15
  } else {
    minRewards = 1 * realDays * 5
  }

  return parseEther(minRewards.toString())
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

const getPoolBalance = async (contract: StakingPool): Promise<BigNumber> => {
  return await contract["poolBalance()"]()
}

const getClaimedRewards = async (contract: StakingPool, ...tokenIds: number[]): Promise<BigNumber> => {
  const claimedRewards = []

  for (const tokenId of tokenIds) {
    const entry = await contract.poolEntry(tokenId)
    claimedRewards.push(entry.claimedRewards)
  }

  return claimedRewards.reduce((prev, curr) => prev.add(curr), BigNumber.from(0))
}

const getTotalRewards = async (contract: StakingPool, ...tokenIds: number[]): Promise<BigNumber> => {
  const pendingRewards = []

  for (const tokenId of tokenIds) {
    const rewards = await contract.pendingRewards(tokenId)
    pendingRewards.push(rewards)
  }

  return pendingRewards.reduce((prev, curr) => prev.add(curr), BigNumber.from(0))
}

const getTotalRewardsArray = async (contract: StakingPool, ...tokenIds: number[]): Promise<BigNumber[]> => {
  const pendingRewards = []

  for (const tokenId of tokenIds) {
    const rewards = await contract.pendingRewards(tokenId)
    pendingRewards.push(rewards)
  }

  return pendingRewards
}

const getRewardsWithoutFee = (rewards: BigNumber): BigNumber => {
  return rewards.mul(100).div(97)
}

const getRewardsWithoutExternalFee = (rewards: BigNumber): BigNumber => {
  return rewards.mul(1000).div(985)
}

const getBalanceChange = async (contract: MockContract<WeSenditToken>, address: string, action: Function, delta?: BigNumber): Promise<BigNumber> => {
  const balanceBefore = await contract.balanceOf(address)
  await action()
  const balanceAfter = await contract.balanceOf(address)

  if (delta) {
    return balanceAfter.sub(balanceBefore).sub(delta)
  }

  return balanceAfter.sub(balanceBefore)
}

const increaseToSinceStakingStart = async (contract: StakingPool, tokenId: number, duration: number): Promise<number> => {
  const entry = await contract.poolEntry(tokenId)
  const current = await getBlockTimestamp()
  const end = entry.startedAt.toNumber() + duration

  const diff = end - current;
  for (let i = 1; i < Math.ceil(diff / (12 * 60 * 60)); i++) {
    await time.increase(12 * 60 * 60)
    await contract.updatePool()
  }

  await time.increaseTo(end)

  const now = await getBlockTimestamp()
  return now - entry.startedAt.toNumber()
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

  let ADMIN: string
  let UPDATE_ALLOCATED_POOL_SHARES: string

  beforeEach(async function () {
    [owner, alice, bob, ...addrs] = await ethers.getSigners()

    const WeSenditToken = await smock.mock<WeSenditToken__factory>('WeSenditToken')
    mockWsi = await WeSenditToken.deploy(owner.address)

    const WeStakeitToken = await smock.mock<WeStakeitToken__factory>('WeStakeitToken')
    mockProofToken = await WeStakeitToken.deploy()

    const StakingPool = await ethers.getContractFactory("StakingPool")
    contract = await StakingPool.deploy(mockWsi.address, mockProofToken.address)

    ADMIN = await contract.ADMIN()
    UPDATE_ALLOCATED_POOL_SHARES = await contract.UPDATE_ALLOCATED_POOL_SHARES()

    await contract.grantRole(UPDATE_ALLOCATED_POOL_SHARES, owner.address)

    await mockProofToken.transferOwnership(contract.address)
    await mockWsi.unpause()
    await mockWsi.transfer(contract.address, INITIAL_POOL_BALANCE)
    await mockWsi.transfer(alice.address, parseEther('10000000'))
  });

  describe("Deployment", async function () {
    it("should set the right owner", async function () {
      expect(await contract.owner()).to.equal(owner.address)
    });

    it("should assign correct initial values", async function () {
      expect(await contract.TOKEN_PER_SECOND()).to.equal(BigNumber.from('7654263202075702075'))
      expect(await contract.poolPaused()).to.be.false
      expect(await contract.emergencyUnstakeEnabled()).to.be.false
      expect(await contract.currentPoolFactor()).to.equal(INITIAL_POOL_FACTOR)
      expect(await contract.lastRewardTimestamp()).to.equal(0)
      expect(await contract.allocatedPoolShares()).to.equal(0)
      expect(await contract.activeAllocatedPoolShares()).to.equal(0)
      expect(await contract.lastActiveAllocatedPoolSharesTimestamp()).to.equal(0)
      expect(await contract.reservedRewards()).to.equal(0)
      expect(await contract.reservedFees()).to.equal(0)
      expect(await contract.accRewardsPerShare()).to.equal(0)
      expect(await contract.totalPoolShares()).to.equal(24072351600)
      expect(await contract.totalTokenLocked()).to.equal(0)
      expect(await contract.minDuration()).to.equal(7)
      expect(await contract.maxDuration()).to.equal(364)
      expect(await contract.stakeToken()).to.equal(mockWsi.address)
      expect(await contract.proofToken()).to.equal(mockProofToken.address)
      expect(await contract.maxStakingAmount()).to.equal(parseEther('1000000'))
    })

    it("should assign correct roles to creator", async function () {
      expect(await contract.hasRole(ADMIN, owner.address)).to.equal(true)

      expect(await contract.getRoleAdmin(ADMIN)).to.equal(ADMIN)
      expect(await contract.getRoleAdmin(UPDATE_ALLOCATED_POOL_SHARES)).to.equal(ADMIN)
    })
  });

  describe('Pool Factor Calculation', async function () {
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
          await contract["poolFactor(uint256)"](parseEther(value.input.toString()))
        ).to.be.closeTo(value.output, 1000)
      })
    }

    xit(`should generate values for graph`, async function () {
      const arr = []

      for (let i = 0; i <= Math.floor(120_000_000 / 100000); i++) {
        const input = 120_000_000 - (100000 * i)
        const output = await contract["poolFactor(uint256)"](parseEther(input.toString()))
        arr.push(`${input};${Number(formatEther(output)).toFixed(2).replace('.', ',')}`)
      }

      writeFileSync(join(__dirname, 'arr.txt'), arr.reverse().join('\n'))
    })
  })

  describe('APY / APR calculation', async function () {
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

  describe('Pool Balance', async function () {
    it('should calculate correct pool balance', async function () {
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

        const pendingRewards = await contract.pendingRewards(0)

        expect(pendingRewards).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, i * 86400, 31449600),
          minRewardPrecision(i)
        )

        const totalReward = getRewardsWithoutFee(pendingRewards)
        const totalRewardsWithoutFee = totalReward.mul(985).div(1000)

        expect(await getPoolBalance(contract)).to.be.closeTo(
          INITIAL_POOL_BALANCE.sub(totalRewardsWithoutFee),
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct pool balance with multiple stakers', async function () {
      const amount = parseEther('1000000')

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

      // Day 1 -> 364
      for (let i = 1; i <= 364; i++) {
        // Start from second entry to skip math
        await increaseToSinceStakingStart(contract, 1, i * 86400)

        const pendingRewardsTotal = await getTotalRewards(contract, 0, 1)
        const totalRewards = getRewardsWithoutFee(pendingRewardsTotal)
        const totalRewardsWithoutFee = totalRewards.mul(985).div(1000)

        expect(await getPoolBalance(contract)).to.be.closeTo(
          INITIAL_POOL_BALANCE.sub(totalRewardsWithoutFee),
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct pool balance with multiple stakers and pool update', async function () {
      const amount = parseEther('1000000')

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

      // Day 1 -> 182
      for (let i = 1; i <= 182; i++) {
        // Start from second entry to skip math
        await increaseToSinceStakingStart(contract, 1, i * 86400)

        const pendingRewards = await getTotalRewards(contract, 0, 1)
        const totalRewards = getRewardsWithoutFee(pendingRewards)
        const totalRewardsWithoutFee = totalRewards.mul(985).div(1000)

        expect(await getPoolBalance(contract)).to.be.closeTo(
          INITIAL_POOL_BALANCE.sub(totalRewardsWithoutFee),
          MIN_REWARD_PRECISION
        )
      }

      // Trigger pool update
      await contract.updatePool()

      // Day 183 -> 364
      for (let i = 183; i <= 364; i++) {
        // Start from second entry to skip math
        await increaseToSinceStakingStart(contract, 1, i * 86400)

        const pendingRewards = await getTotalRewards(contract, 0, 1)
        const totalRewards = getRewardsWithoutFee(pendingRewards)
        const totalRewardsWithoutFee = totalRewards.mul(985).div(1000)

        expect(await getPoolBalance(contract)).to.be.closeTo(
          INITIAL_POOL_BALANCE.sub(totalRewardsWithoutFee),
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct pool balance with multiple stakers and activeAllocatedPoolShares update', async function () {
      const amount = parseEther('1000000')

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

      // Skip first staking entry
      await increaseToSinceStakingStart(contract, 1, 31449600)

      // Check pool balance
      const totalRewardsBeforeUpdate = await getTotalRewards(contract, 0, 1)
      const totalRewardsBeforeUpdateWithoutFee = totalRewardsBeforeUpdate.mul(985).div(1000)
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE.sub(getRewardsWithoutFee(totalRewardsBeforeUpdateWithoutFee)),
        MIN_REWARD_PRECISION
      )

      // Update active pool shares (this is done off-chain)
      const activePoolShares = (await contract.poolEntry(0)).shares
      await contract.setActiveAllocatedPoolShares(activePoolShares)

      // Check state
      expect(await contract.lastActiveAllocatedPoolSharesTimestamp()).to.equal(await getBlockTimestamp())

      // Check pool balance
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE.sub(getRewardsWithoutFee(totalRewardsBeforeUpdateWithoutFee).div(2)),
        MIN_REWARD_PRECISION
      )
    })

    it('should calculate correct pool balance with multiple stakers', async function () {
      const amount = parseEther('1000000')

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

      // Check pool balance
      expect(await contract["poolBalance()"]()).to.be.closeTo(
        INITIAL_POOL_BALANCE,
        MIN_REWARD_PRECISION
      )

      // Skip one year since first stake
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Get pending rewards
      const pendingRewards = await getTotalRewards(contract, 0, 1)
      const totalRewards = getRewardsWithoutFee(pendingRewards)
      const totalRewardsWithoutFee = totalRewards.mul(985).div(1000)

      // Check pool balance again
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE.sub(totalRewardsWithoutFee),
        MIN_REWARD_PRECISION
      )
    })

    it('should calculate correct pool balance with multiple stakers and unstake', async function () {
      const amount = parseEther('1000000')

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

      // Check pool balance
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE,
        MIN_REWARD_PRECISION
      )

      // Skip one year since first stake
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Check pool balance again
      const pendingRewardsBeforeUnstake = await getTotalRewards(contract, 0, 1)
      const totalRewardsBeforeUpdate = getRewardsWithoutFee(pendingRewardsBeforeUnstake)
      const totalRewardsBeforeUpdateWithoutFee = totalRewardsBeforeUpdate.mul(985).div(1000)

      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE.sub(totalRewardsBeforeUpdateWithoutFee),
        MIN_REWARD_PRECISION
      )

      const poolBalanceBeforeUnstake = await getPoolBalance(contract)

      // Unstake first entry
      await contract.connect(alice).unstake(0)

      const poolBalanceAfterUnstake = await getPoolBalance(contract);

      expect(poolBalanceBeforeUnstake).to.be.closeTo(
        poolBalanceAfterUnstake,
        MIN_REWARD_PRECISION
      )

      // Get pending rewards
      const pendingRewards = await getTotalRewards(contract, 0, 1)
      const claimedRewards = await getClaimedRewards(contract, 0, 1)
      const totalRewards = getRewardsWithoutFee(
        pendingRewards.add(claimedRewards)
      )
      const totalRewardsWithoutFee = totalRewards.mul(985).div(1000)

      // Check pool balance again
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE.sub(totalRewardsWithoutFee),
        MIN_REWARD_PRECISION
      )
    })

    it('should calculate correct pool balance with multiple stakers and claim', async function () {
      const amount = parseEther('1000000')

      for (let i = 0; i < 2; i++) {
        // Arrange
        await mockWsi.connect(alice).approve(contract.address, amount)

        // Act & Assert
        await contract.connect(alice).stake(
          amount,
          364,
          false
        )
      }

      // Assert

      // Check pool balance
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE,
        MIN_REWARD_PRECISION
      )

      // Update pool every 12 hours
      for (let i = 1; i < Math.ceil(31449600 / 1036800 / 2); i++) {
        await increaseToSinceStakingStart(contract, 0, i * 1036800)
        await contract.updatePool()
      }

      // Check pool balance again
      const pendingRewardsBeforeClaim = await getTotalRewards(contract, 0, 1)
      const totalRewardsBeforeClaim = getRewardsWithoutFee(pendingRewardsBeforeClaim)
      const totalRewardsBeforeClaimWithoutFee = totalRewardsBeforeClaim.mul(985).div(1000)

      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE.sub(totalRewardsBeforeClaimWithoutFee),
        MIN_REWARD_PRECISION
      )

      const poolBalanceBeforeClaim = await getPoolBalance(contract)

      // Unstake first entry
      await contract.connect(alice).claimRewards(0)

      const poolBalanceAfterClaim = await getPoolBalance(contract);

      expect(poolBalanceBeforeClaim).to.be.closeTo(
        poolBalanceAfterClaim,
        MIN_REWARD_PRECISION
      )

      // Update pool every 12 hours
      for (let i = 1; i < Math.ceil(31449600 / 1036800 / 2); i++) {
        await increaseToSinceStakingStart(contract, 0, (31449600 / 2) + (i * 1036800))
        await contract.updatePool()
      }

      // Skip one year since first stake
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Get pending rewards
      const pendingRewards = await getTotalRewards(contract, 0, 1)
      const claimedRewards = await getClaimedRewards(contract, 0, 1)
      const totalRewards = getRewardsWithoutFee(pendingRewards.add(claimedRewards))
      const totalRewardsWithoutFee = totalRewards.mul(985).div(1000)

      // Check pool balance again
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE.sub(totalRewardsWithoutFee),
        MIN_REWARD_PRECISION
      )
    })

    it('should calculate correct pool balance with multiple stakers and claim', async function () {
      const amount = parseEther('1000000')

      for (let i = 0; i < 2; i++) {
        // Arrange
        await mockWsi.connect(alice).approve(contract.address, amount)

        // Act & Assert
        await contract.connect(alice).stake(
          amount,
          364,
          false
        )
      }

      // Assert

      // Check pool balance
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE,
        MIN_REWARD_PRECISION
      )

      // Check pool balance again
      const pendingRewardsBeforeClaim = await getTotalRewards(contract, 0, 1)
      const totalRewardsBeforeClaim = getRewardsWithoutFee(pendingRewardsBeforeClaim)

      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE.sub(totalRewardsBeforeClaim),
        MIN_REWARD_PRECISION
      )

      const poolBalanceBeforeClaim = await getPoolBalance(contract)

      // Unstake first entry
      await contract.connect(alice).claimRewards(0)

      const poolBalanceAfterClaim = await getPoolBalance(contract);

      expect(poolBalanceBeforeClaim).to.be.closeTo(
        poolBalanceAfterClaim,
        MIN_REWARD_PRECISION
      )

      // Skip one year since first stake
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Get pending rewards
      const pendingRewards = await getTotalRewards(contract, 0, 1)
      const claimedRewards = await getClaimedRewards(contract, 0, 1)
      const totalRewards = getRewardsWithoutFee(pendingRewards.add(claimedRewards))
      const totalRewardsWithoutFee = totalRewards.mul(985).div(1000)

      // Check pool balance again
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE.sub(totalRewardsWithoutFee),
        MIN_REWARD_PRECISION
      )
    })

    it('should calculate correct pool balance with multiple stakers and claim and fee withdrawal', async function () {
      const amount = parseEther('1000000')

      for (let i = 0; i < 2; i++) {
        // Arrange
        await mockWsi.connect(alice).approve(contract.address, amount)

        // Act & Assert
        await contract.connect(alice).stake(
          amount,
          364,
          false
        )
      }

      // Assert

      // Check pool balance
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE,
        MIN_REWARD_PRECISION
      )

      // Skip one year since first stake
      await increaseToSinceStakingStart(contract, 0, 31449600)

      await contract.connect(alice).claimRewards(0)

      expect(await getBalanceChange(mockWsi, owner.address, async () => {
        await contract.withdrawFee();
      })).to.equal(parseEther('16496.21359486720455'))

      // Get pending rewards
      const pendingRewards = await getTotalRewards(contract, 0, 1)
      const claimedRewards = await getClaimedRewards(contract, 0, 1)
      const totalRewards = getRewardsWithoutFee(pendingRewards.add(claimedRewards))
      const totalRewardsWithoutStakingFee = totalRewards.mul(985).div(1000)

      // Check pool balance again
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE.sub(totalRewardsWithoutStakingFee),
        MIN_REWARD_PRECISION
      )
    })

    it('should calculate correct pool balance with multiple stakers and claim and fee withdrawal', async function () {
      const amount = parseEther('1000000')

      for (let i = 0; i < 2; i++) {
        // Arrange
        await mockWsi.connect(alice).approve(contract.address, amount)

        // Act & Assert
        await contract.connect(alice).stake(
          amount,
          364,
          false
        )
      }

      // Assert

      // Check pool balance
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE,
        MIN_REWARD_PRECISION
      )

      // Skip one year since first stake
      await increaseToSinceStakingStart(contract, 0, 31449600 / 2)

      await contract.connect(alice).claimRewards(0)

      // Skip one year since first stake
      await increaseToSinceStakingStart(contract, 0, 31449600)

      await contract.connect(alice).claimRewards(0)

      expect(await getBalanceChange(mockWsi, owner.address, async () => {
        await contract.withdrawFee();
      })).to.equal(parseEther('16496.213619300406200000'))

      // Get pending rewards
      const pendingRewards = await getTotalRewards(contract, 0, 1)
      const claimedRewards = await getClaimedRewards(contract, 0, 1)
      const totalRewards = getRewardsWithoutFee(pendingRewards.add(claimedRewards))
      const totalRewardsWithoutStakingFee = totalRewards.mul(985).div(1000)

      // Check pool balance again
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE.sub(totalRewardsWithoutStakingFee),
        MIN_REWARD_PRECISION
      )
    })

    it('should calculate correct pool balance with multiple stakers and claim and fee withdrawal', async function () {
      const amount = parseEther('1000000')

      for (let i = 0; i < 2; i++) {
        // Arrange
        await mockWsi.connect(alice).approve(contract.address, amount)

        // Act & Assert
        await contract.connect(alice).stake(
          amount,
          364,
          false
        )
      }

      // Assert

      // Check pool balance
      expect(await getPoolBalance(contract)).to.be.closeTo(
        INITIAL_POOL_BALANCE,
        MIN_REWARD_PRECISION
      )

      // Skip one year since first stake
      await increaseToSinceStakingStart(contract, 0, 31449600)
      await contract.connect(alice).claimRewards(0)

      const poolBalanceBeforeWithdraw = await getPoolBalance(contract)

      expect(await getBalanceChange(mockWsi, owner.address, async () => {
        await contract.withdrawFee();
      })).to.equal(parseEther('16496.21359486720455'))

      const poolBalanceAfterWithdraw = await getPoolBalance(contract)

      // Compare pool balance
      expect(poolBalanceBeforeWithdraw).to.be.closeTo(
        poolBalanceAfterWithdraw,
        MIN_REWARD_PRECISION
      )
    })
  })

  describe('Rewards', async function () {
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
          minRewardPrecision(i)
        )
      }

      // Day 364
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
        minRewardPrecision(364)
      )

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
          minRewardPrecision(i, 364)
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
          minRewardPrecision(i).mul(2)
        )

        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, (i * 86400) - startDiff, 31449600),
          minRewardPrecision(i).mul(2)
        )
      }

      // Day 364
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
        minRewardPrecision(364).mul(2)
      )

      expect(await contract.pendingRewards(1)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 - startDiff, 31449600),
        minRewardPrecision(364).mul(2)
      )

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
          minRewardPrecision(i).mul(2)
        )

        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 - startDiff, 31449600),
          minRewardPrecision(i).mul(2)
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
          minRewardPrecision(i).mul(2)
        )

        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, (i * 86400) - startDiff, 31449600),
          minRewardPrecision(i).mul(2)
        )
      }

      // Day 364
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 - startDiff, 31449600, rewardsBeforeSecondStaker),
        minRewardPrecision(364).mul(2)
      )

      expect(await contract.pendingRewards(1)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 - startDiff, 31449600),
        minRewardPrecision(364).mul(2)
      )

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.be.closeTo(
          await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600 - startDiff, 31449600, rewardsBeforeSecondStaker),
          minRewardPrecision(i).mul(2)
        )

        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
          minRewardPrecision(i).mul(2)
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
        minRewardPrecision(364)
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
          minRewardPrecision(i).mul(2)
        )
      }

      // Day 728
      expect(await contract.pendingRewards(0)).to.equal(0)
      expect(await contract.pendingRewards(1)).to.be.closeTo(
        await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
        minRewardPrecision(364).mul(2)
      )

      // Day 729 -> 1093
      for (let i = 729; i <= 1093; i++) {
        await increaseToSinceStakingStart(contract, 0, i * 86400)

        expect(await contract.pendingRewards(0)).to.equal(0)
        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewards(contract, maxRewards, INITIAL_POOL_FACTOR, 31449600, 31449600),
          minRewardPrecision(i).mul(2)
        )
      }
    })

    xit('should calculate correct rewards with unstake mid-staking (auto-compounding = true)', async function () {
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
        minRewardPrecision(364).mul(2)
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
        minRewardPrecision(timeSinceUnstake / 86400).mul(2)
      )

      // Day 182 -> 364
      for (let i = 182; i <= 364; i++) {
        await increaseToSinceStakingStart(contract, 1, i * 86400)
        const sinceUpdate = await getTimeSinceLastRewardTimestamp(contract)

        expect(await contract.pendingRewards(0)).to.equal(0)
        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, sinceUpdate, 31449600, rewardsAfterUnstake),
          minRewardPrecision(i, 181).mul(5)
        )
      }

      // Day 365
      const sinceUpdate = await getTimeSinceLastRewardTimestamp(contract)
      expect(await contract.pendingRewards(0)).to.equal(0)
      expect(await contract.pendingRewards(1)).to.be.closeTo(
        await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, sinceUpdate, 31449600, rewardsAfterUnstake),
        minRewardPrecision(sinceUpdate / 86400).mul(2)
      )

      // Day 365 -> 728
      for (let i = 365; i <= 728; i++) {
        await increaseToSinceStakingStart(contract, 1, i * 86400)

        expect(await contract.pendingRewards(0)).to.equal(0)
        expect(await contract.pendingRewards(1)).to.be.closeTo(
          await calculateExpectedRewardsSince(contract, maxRewards, INITIAL_POOL_FACTOR, sinceUpdate, 31449600, rewardsAfterUnstake),
          minRewardPrecision(i, 364).mul(2)
        )
      }
    })

    xit('should calculate correct rewards with pool update before staking (auto-compounding = true)', async function () {
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

    xit('should calculate correct rewards with pool update mid-staking (auto-compounding = true)', async function () {
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

    xit('should calculate correct rewards with pool update after staking (auto-compounding = true)', async function () {
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

    xit('should calculate correct rewards with pool update delayed after staking (auto-compounding = true)', async function () {
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

    xit('should calculate correct rewards with multiple pool update before staking (auto-compounding = true)', async function () {
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

    xit('should calculate correct rewards with multiple pool updates mid-staking (auto-compounding = true)', async function () {
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

    xit('should calculate correct rewards with multiple pool update after staking (auto-compounding = true)', async function () {
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

    xit('should calculate correct rewards with multiple pool update delayed after staking (auto-compounding = true)', async function () {
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

    it('should calculate correct rewards', async function () {
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

      // Skip to end
      await increaseToSinceStakingStart(contract, 0, 364 * 86400)

      // Assert rewards
      expect(await contract.pendingRewards(0)).to.equal(parseEther('1945476.714151448331021107'))
    })

    it('should calculate correct rewards for multiple stakers', async function () {
      const amount = parseEther('1000000')

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

      // Skip to end
      await increaseToSinceStakingStart(contract, 0, 364 * 86400)

      // Assert rewards
      expect(await contract.pendingRewards(0)).to.be.closeTo(
        parseEther('1944370.255901906008044803'),
        parseEther('0.5')
      )
      expect(await contract.pendingRewards(1)).to.be.closeTo(
        parseEther('1944370.255901906008044803'),
        parseEther('0.5')
      )
    })

    it('should calculate correct rewards for multiple stakers', async function () {
      const amount = parseEther('1000000')

      for (let i = 0; i < 9; i++) {
        // Arrange
        await mockWsi.connect(alice).approve(contract.address, amount)

        // Act & Assert
        await contract.connect(alice).stake(
          amount,
          364,
          true
        )
      }

      // Skip to end
      await increaseToSinceStakingStart(contract, 0, 364 * 86400)

      // Assert rewards
      for (let i = 0; i < 9; i++) {
        expect(await contract.pendingRewards(i)).to.be.closeTo(
          parseEther('1916760.756419425403960490'),
          MIN_REWARD_PRECISION
        )
      }
    })

    it('should calculate correct rewards for multiple stakers after unstake', async function () {
      const amount = parseEther('1000000')

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

      // Skip to end
      await increaseToSinceStakingStart(contract, 0, 364 * 86400)

      // Snapshot rewards
      expect(await contract.pendingRewards(1)).to.equal(parseEther('1944370.132157984423701320'))

      // Unstake
      await contract.connect(alice).unstake(0)

      // Assert rewards
      expect(await contract.pendingRewards(0)).to.equal(0)
      expect(await contract.pendingRewards(1)).to.be.closeTo(
        parseEther('1944370.193889548652478333'),
        parseEther('0.1')
      )
    })
  })

  describe('Stake', async function () {
    it('should stake (auto-compounding = true)', async function () {
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
      expect(await mockProofToken.tokenURI(0)).to.equal("https://app.wesendit.io/api/tokenMetadata/0")

      const entry = await contract.poolEntry(0)
      expect(entry).to.have.length(10)
      expect(entry.amount).to.equal(amount)
      expect(entry.duration).to.equal(364)
      expect(entry.shares).to.equal(200602930)
      expect(entry.rewardDebt).to.equal(0)
      expect(entry.claimedRewards).to.equal(0)
      expect(entry.collectedFees).to.equal(0)
      expect(entry.lastClaimedAt).to.equal(await getBlockTimestamp())
      expect(entry.startedAt).to.equal(await getBlockTimestamp())
      expect(entry.isUnstaked).to.be.false
      expect(entry.isAutoCompoundingEnabled).to.be.true
      expect(await contract.totalTokenLocked()).to.equal(amount)
      expect(await contract.allocatedPoolShares()).to.equal(200602930)
      expect(await contract.activeAllocatedPoolShares()).to.equal(200602930)
    })

    it('should stake (auto-compounding = false)', async function () {
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
      expect(entry).to.have.length(10)
      expect(entry.amount).to.equal(amount)
      expect(entry.duration).to.equal(364)
      expect(entry.shares).to.equal(110000000)
      expect(entry.rewardDebt).to.equal(0)
      expect(entry.claimedRewards).to.equal(0)
      expect(entry.collectedFees).to.equal(0)
      expect(entry.lastClaimedAt).to.equal(await getBlockTimestamp())
      expect(entry.startedAt).to.equal(await getBlockTimestamp())
      expect(entry.isUnstaked).to.be.false
      expect(entry.isAutoCompoundingEnabled).to.be.false
      expect(await contract.totalTokenLocked()).to.equal(amount)
      expect(await contract.allocatedPoolShares()).to.equal(110000000)
      expect(await contract.activeAllocatedPoolShares()).to.equal(110000000)
    })

    it('should stake multiple times (auto-compounding = true)', async function () {
      const amount = parseEther('100000')

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
      expect(firstEntry.shares).to.equal(20060293)

      const secondEntry = await contract.poolEntry(0)
      expect(secondEntry.shares).to.equal(20060293)
    })

    it('should stake multiple times (auto-compounding = false)', async function () {
      const amount = parseEther('100000')

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
      expect(firstEntry.shares).to.equal(11000000)

      const secondEntry = await contract.poolEntry(0)
      expect(secondEntry.shares).to.equal(11000000)
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

    it('should fail to stake if transfer fails', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Setup mock
      mockWsi.transferFrom.returnsAtCall(0, false)

      // Act & Assert
      await expect(contract.connect(alice).stake(
        amount,
        364,
        true
      )).to.be.revertedWith('Staking Pool: Failed to transfer token')
    })

    it('should fail to stake if total amount is higher max. staking amount (pool balance > 80% of initial balance)', async function () {
      // Arrange
      await mockWsi.connect(alice).approve(contract.address, parseEther('2000000'))

      // Act & Assert
      await expect(contract.connect(alice).stake(
        parseEther('1000000'),
        364,
        false
      )).to.not.be.reverted

      await expect(contract.connect(alice).stake(
        parseEther('1000000'),
        364,
        false
      )).to.be.revertedWith('Staking Pool: User max. staking amount exceeded')
    })

    it('should fail to stake amount is higher max. staking amount (pool balance <= 80% of initial balance)', async function () {
      // Arrange

      // Drain 20% of pool balance
      await contract.emergencyWithdrawToken(mockWsi.address, parseEther('24000000'))

      await mockWsi.connect(alice).approve(contract.address, parseEther('1920000'))

      // Act & Assert
      await expect(contract.connect(alice).stake(
        parseEther('960000'),
        364,
        false
      )).to.not.be.reverted

      await expect(contract.connect(alice).stake(
        parseEther('960000'),
        364,
        false
      )).to.be.revertedWith('Staking Pool: Max. staking amount exceeded')
    })
  })

  describe('Un-stake', async function () {
    it('should unstake token', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Skip to staking end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Snapshot pending rewards
      const pendingRewards = await contract.pendingRewards(0)

      // Un-stake token
      expect(await getBalanceChange(mockWsi, alice.address, async () => {
        await contract.connect(alice).unstake(0)
      })).to.be.closeTo(
        amount.add(pendingRewards),
        MIN_REWARD_PRECISION
      )

      // Check state
      const entry = await contract.poolEntry(0)
      expect(entry.lastClaimedAt).to.equal(await getBlockTimestamp())
      expect(entry.claimedRewards).to.be.closeTo(
        pendingRewards,
        MIN_REWARD_PRECISION
      )
      expect(entry.isUnstaked).to.be.true
      expect(await contract.totalTokenLocked()).to.equal(0)
      expect(await contract.allocatedPoolShares()).to.equal(0)
      expect(await contract.pendingRewards(0)).to.equal(0)

      // Skip one year
      await increaseToSinceStakingStart(contract, 0, 31449600 * 2)

      // Check rewards
      expect(await contract.pendingRewards(0)).to.equal(0)
    })

    it('should fail to unstake token before duration passed', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Skip close to staking end
      await increaseToSinceStakingStart(contract, 0, 31449600 - 2)

      // Check for transaction status
      await expect(contract.connect(alice).unstake(0)).to.be.revertedWith('Staking Pool: Staking entry is locked')
    })

    it('should fail to unstake token twice', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Skip close to staking end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Unstake
      await contract.connect(alice).unstake(0)

      // Check for transaction status
      await expect(contract.connect(alice).unstake(0)).to.be.revertedWith('Staking Pool: Staking entry was already unstaked')
    })

    it('should fail to unstake token if transfer fails', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Skip close to staking end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Setup mock
      mockWsi.transfer.returnsAtCall(3, false)

      // Check for transaction status
      await expect(contract.connect(alice).unstake(0)).to.be.revertedWith('Staking Pool: Failed to transfer initial stake')
    })

    it('should fail to unstake token if caller is not token owner', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Skip close to staking end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Check for transaction status
      await expect(contract.connect(bob).unstake(0)).to.be.revertedWith('Staking Pool: Caller is not entry owner')
    })
  })

  describe('Claim', async function () {
    it('should claim token', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        false
      )

      // Skip some days
      await increaseToSinceStakingStart(contract, 0, 5 * 86400)

      // Snapshot pending rewards
      const pendingRewards = await contract.pendingRewards(0)

      // Claim token
      expect(await getBalanceChange(mockWsi, alice.address, async () => {
        await contract.connect(alice).claimRewards(0)
      })).to.be.closeTo(
        pendingRewards,
        MIN_REWARD_PRECISION
      )

      // Check state
      const entry = await contract.poolEntry(0)
      expect(entry.lastClaimedAt).to.equal(await getBlockTimestamp())
      expect(entry.claimedRewards).to.be.closeTo(
        pendingRewards,
        MIN_REWARD_PRECISION
      )
      expect(entry.isUnstaked).to.be.false
      expect(await contract.pendingRewards(0)).to.equal(0)

      // Skip some days
      await increaseToSinceStakingStart(contract, 0, 10 * 86400)
      expect(await contract.pendingRewards(0)).to.not.equal(0)

      // Skip to end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Snapshot pending rewards
      const pendingRewardsEnd = await contract.pendingRewards(0)

      // Claim token
      expect(await getBalanceChange(mockWsi, alice.address, async () => {
        await contract.connect(alice).claimRewards(0)
      }, amount)).to.be.closeTo(
        pendingRewardsEnd,
        MIN_REWARD_PRECISION
      )

      // Check state
      const entryEnd = await contract.poolEntry(0)
      expect(entryEnd.lastClaimedAt).to.equal(await getBlockTimestamp())
      expect(entryEnd.claimedRewards).to.be.closeTo(
        pendingRewardsEnd.add(pendingRewards),
        MIN_REWARD_PRECISION
      )
      expect(entryEnd.isUnstaked).to.be.true

      // Skip some days
      await increaseToSinceStakingStart(contract, 0, 31449600 + (10 * 86400))
      expect(await contract.pendingRewards(0)).to.equal(0)
    })

    it('should claim token on staking end (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Skip to end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Snapshot pending rewards
      const pendingRewards = await contract.pendingRewards(0)

      // Claim token
      expect(await getBalanceChange(mockWsi, alice.address, async () => {
        await contract.connect(alice).claimRewards(0)
      }, amount)).to.be.closeTo(
        pendingRewards,
        MIN_REWARD_PRECISION
      )

      // Check state
      const entry = await contract.poolEntry(0)
      expect(entry.lastClaimedAt).to.equal(await getBlockTimestamp())
      expect(entry.claimedRewards).to.be.closeTo(
        pendingRewards,
        MIN_REWARD_PRECISION
      )
      expect(entry.isUnstaked).to.be.true
      expect(await contract.pendingRewards(0)).to.equal(0)
    })

    it('should claim and unstake token', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        false
      )

      // Skip to end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Snapshot pending rewards
      const pendingRewards = await contract.pendingRewards(0)

      // Claim token
      expect(await getBalanceChange(mockWsi, alice.address, async () => {
        await contract.connect(alice).claimRewards(0)
      }, amount)).to.be.closeTo(
        pendingRewards,
        MIN_REWARD_PRECISION
      )

      const timestampClaimed = await getBlockTimestamp()

      // Un-stake
      await expect(contract.connect(alice).unstake(0)).to.be.revertedWith('Staking Pool: Staking entry was already unstaked')

      // Check state
      const entry = await contract.poolEntry(0)
      expect(entry.lastClaimedAt).to.equal(timestampClaimed)
      expect(entry.claimedRewards).to.be.closeTo(
        pendingRewards,
        MIN_REWARD_PRECISION
      )
      expect(entry.isUnstaked).to.be.true
      expect(await contract.pendingRewards(0)).to.equal(0)
    })

    it('should claim and unstake token on staking end (auto-compounding = true)', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Skip to end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Snapshot pending rewards
      const pendingRewards = await contract.pendingRewards(0)

      // Claim token
      expect(await getBalanceChange(mockWsi, alice.address, async () => {
        await contract.connect(alice).claimRewards(0)
      }, amount)).to.be.closeTo(
        pendingRewards,
        MIN_REWARD_PRECISION
      )

      const timestampClaimed = await getBlockTimestamp()

      // Un-stake
      await expect(contract.connect(alice).unstake(0)).to.be.revertedWith('Staking Pool: Staking entry was already unstaked')

      // Check state
      const entry = await contract.poolEntry(0)
      expect(entry.lastClaimedAt).to.equal(timestampClaimed)
      expect(entry.claimedRewards).to.be.closeTo(
        pendingRewards,
        MIN_REWARD_PRECISION
      )
      expect(entry.isUnstaked).to.be.true
      expect(await contract.pendingRewards(0)).to.equal(0)
    })

    it('should unstake token (and claim simultaneously)', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        false
      )

      // Skip to end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Snapshot pending rewards
      const pendingRewards = await contract.pendingRewards(0)

      // Claim token
      expect(await getBalanceChange(mockWsi, alice.address, async () => {
        await contract.connect(alice).unstake(0)
      })).to.be.closeTo(
        amount.add(pendingRewards),
        MIN_REWARD_PRECISION
      )

      // Check state
      const entry = await contract.poolEntry(0)
      expect(entry.lastClaimedAt).to.equal(await getBlockTimestamp())
      expect(entry.claimedRewards).to.be.closeTo(
        pendingRewards,
        MIN_REWARD_PRECISION
      )
      expect(entry.isUnstaked).to.be.true
      expect(await contract.pendingRewards(0)).to.equal(0)
    })

    it('should fail to claim if already unstaked', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        false
      )

      // Skip to end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Unstake
      await contract.connect(alice).unstake(0)

      // Check transaction status
      // TODO: maybe move validate in function
      await expect(contract.connect(alice).claimRewards(0)).to.be.revertedWith("Staking Pool: No rewards available to claim")
    })

    it('should fail to claim (auto-compounding = true) before duration passed', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Skip close to end
      await increaseToSinceStakingStart(contract, 0, 31449600 - 2)

      await expect(contract.connect(alice).claimRewards(0)).to.be.revertedWith("Staking Pool: Cannot claim before staking end")
    })

    it('should fail to claim token if transfer fails', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Skip close to staking end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Setup mock
      mockWsi.transfer.returnsAtCall(2, false)

      // Check for transaction status
      await expect(contract.connect(alice).claimRewards(0)).to.be.revertedWith('Staking Pool: Failed to transfer rewards')
    })

    it('should fail to claim token if caller is not token owner', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Skip close to staking end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Check for transaction status
      await expect(contract.connect(bob).claimRewards(0)).to.be.revertedWith('Staking Pool: Caller is not entry owner')
    })
  })

  describe('Claim Multiple', async function () {
    it('should claim multiple token', async function () {
      const amount = parseEther('1000000')

      for (let i = 0; i < 2; i++) {
        // Arrange
        await mockWsi.connect(alice).approve(contract.address, amount)

        // Act & Assert
        await contract.connect(alice).stake(
          amount,
          364,
          false
        )
      }

      // Skip some days
      await increaseToSinceStakingStart(contract, 1, 5 * 86400)

      // Snapshot pending rewards
      const pendingRewards = await getTotalRewards(contract, 0, 1)
      const pendingRewardsArray = await getTotalRewardsArray(contract, 0, 1)

      // Claim token
      expect(await getBalanceChange(mockWsi, alice.address, async () => {
        await contract.connect(alice).claimMultipleRewards([
          0, 1
        ])
      })).to.be.closeTo(
        pendingRewards,
        MIN_REWARD_PRECISION
      )

      // Check state
      for (let i = 0; i < 2; i++) {
        const entry = await contract.poolEntry(i)
        expect(entry.lastClaimedAt).to.equal(await getBlockTimestamp())
        expect(entry.claimedRewards).to.be.closeTo(
          pendingRewardsArray[i],
          MIN_REWARD_PRECISION
        )
        expect(entry.isUnstaked).to.be.false
      }

      expect(await getTotalRewards(contract, 0, 1)).to.equal(0)

      // Skip some days
      await increaseToSinceStakingStart(contract, 0, 10 * 86400)
      expect(await getTotalRewards(contract, 0, 1)).to.not.equal(0)

      // Skip to end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Snapshot pending rewards
      const pendingRewardsEnd = await getTotalRewards(contract, 0, 1)
      const pendingRewardsArrayEnd = await getTotalRewardsArray(contract, 0, 1)

      // Claim token
      expect(await getBalanceChange(mockWsi, alice.address, async () => {
        await contract.connect(alice).claimMultipleRewards([
          0, 1
        ])
      }, amount)).to.be.closeTo(
        pendingRewardsEnd,
        MIN_REWARD_PRECISION
      )

      // Check state
      for (let i = 0; i < 2; i++) {
        const entry = await contract.poolEntry(i)
        expect(entry.isUnstaked).to.equal(i == 0 ? true : false)
        expect(entry.lastClaimedAt).to.equal(await getBlockTimestamp())
        expect(entry.claimedRewards).to.be.closeTo(
          pendingRewardsArray[i].add(pendingRewardsArrayEnd[i]),
          MIN_REWARD_PRECISION
        )
      }

      // Skip to second staking end
      await increaseToSinceStakingStart(contract, 1, 31449600)
      expect(await getTotalRewards(contract, 0, 1)).to.be.closeTo(
        parseEther('1'),
        MIN_REWARD_PRECISION
      )

      await contract.setActiveAllocatedPoolShares(110000000)

      // Skip some days
      await increaseToSinceStakingStart(contract, 0, 31449600 + (10 * 86400))
      expect(await getTotalRewards(contract, 0, 1)).to.equal(0)
    })
  })

  describe('Pool Pause', async function () {
    it('should fail to stake if pool is paused', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Pause pool
      await contract.setPoolPaused(true)

      // Act & Assert
      await expect(contract.connect(alice).stake(
        amount,
        364,
        true
      )).to.be.revertedWith('Staking Pool: Pool operations are currently paused')
    })

    it('should fail to unstake token if pool is paused', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Skip close to staking end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Pause pool
      await contract.setPoolPaused(true)

      // Check for transaction status
      await expect(contract.connect(alice).unstake(0)).to.be.revertedWith('Staking Pool: Pool operations are currently paused')
    })

    it('should fail to claim token if pool is paused', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Act & Assert
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Skip close to staking end
      await increaseToSinceStakingStart(contract, 0, 31449600)

      // Pause pool
      await contract.setPoolPaused(true)

      // Check for transaction status
      await expect(contract.connect(alice).claimRewards(0)).to.be.revertedWith('Staking Pool: Pool operations are currently paused')
    })
  })

  describe('User Address Limit', async function () {

  })

  describe('Emergency Unstake', async function () {
    it('should fail to emergency unstake if disabled', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Stake token
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Assert
      await expect(contract.connect(alice).emergencyUnstake(0)).to.be.revertedWith('Staking Pool: Emergency unstake disabled')
    })

    it('should fail to emergency unstake if caller is not entry owner', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Stake token
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Assert
      await expect(contract.connect(bob).emergencyUnstake(0)).to.be.revertedWith('Staking Pool: Caller is not entry owner')
    })

    it('should emergency unstake token', async function () {
      const amount = parseEther('1000000')

      // Arrange
      await mockWsi.connect(alice).approve(contract.address, amount)

      // Stake token
      await contract.connect(alice).stake(
        amount,
        364,
        true
      )

      // Enable emergency unstake
      await contract.setEmergencyUnstakeEnabled(true)

      // Assert
      expect(await getBalanceChange(mockWsi, alice.address, async () => {
        await contract.connect(alice).emergencyUnstake(0)
      })).to.equal(amount)

      const entry = await contract.poolEntry(0)
      expect(entry.isUnstaked).to.be.true
      expect(await contract.totalTokenLocked()).to.equal(0)
      expect(await contract.allocatedPoolShares()).to.equal(0)
      expect(await contract.activeAllocatedPoolShares()).to.equal(0)
    })
  })

  describe('Emergency Withdraw', async function () {
    describe('BNB', async function () {
      beforeEach(async function () {
        await ethers.provider.send('hardhat_setBalance', [
          contract.address,
          '0x56BC75E2D63100000'
        ])
      })

      it('should withdraw all BNB', async function () {
        // Assert
        const balanceBefore = await ethers.provider.getBalance(owner.address)
        expect(await ethers.provider.getBalance(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.emergencyWithdraw(parseEther('100'))
        ).to.not.be.reverted

        // Assert
        const balanceAfter = await ethers.provider.getBalance(owner.address)
        expect(balanceAfter.sub(balanceBefore)).to.closeTo(parseEther('100'), parseEther('0.0001'))
        expect(await ethers.provider.getBalance(contract.address)).to.equal(parseEther('0'))
      })

      it('should withdraw custom amount BNB', async function () {
        // Assert
        const balanceBefore = await ethers.provider.getBalance(owner.address)
        expect(await ethers.provider.getBalance(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.emergencyWithdraw(parseEther('10'))
        ).to.not.be.reverted

        // Assert
        const balanceAfter = await ethers.provider.getBalance(owner.address)
        expect(balanceAfter.sub(balanceBefore)).to.closeTo(parseEther('10'), parseEther('0.0001'))
        expect(await ethers.provider.getBalance(contract.address)).to.equal(parseEther('90'))
      })

      it('should fail on withdraw if caller is non-owner', async function () {
        await expect(
          contract.connect(alice).emergencyWithdraw(parseEther('100'))
        ).to.be.reverted
      })
    })

    describe('Token', async function () {
      beforeEach(async function () {
        await contract.grantRole(ADMIN, alice.address)

        // Drain token first
        const contractBalance = await mockWsi.balanceOf(contract.address)
        await contract.grantRole(ADMIN, bob.address)
        await contract.connect(bob).emergencyWithdrawToken(mockWsi.address, contractBalance)

        const aliceBalance = await mockWsi.balanceOf(alice.address)
        await mockWsi.connect(alice).transfer(bob.address, aliceBalance)

        // Transfer test token to contract
        await mockWsi.transfer(contract.address, parseEther('100'))
      })

      it('should withdraw all token', async function () {
        // Assert
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.connect(alice).emergencyWithdrawToken(mockWsi.address, parseEther('100'))
        ).to.not.be.reverted

        // Assert
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('100'))
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('0'))
      })

      it('should withdraw custom amount token', async function () {
        // Assert
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.connect(alice).emergencyWithdrawToken(mockWsi.address, parseEther('10'))
        ).to.not.be.reverted

        // Assert
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('10'))
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('90'))
      })

      it('should fail on withdraw if caller is non-owner', async function () {
        await expect(
          contract.connect(addrs[0]).emergencyWithdrawToken(mockWsi.address, parseEther('100'))
        ).to.be.reverted
      })

      it('should fail to withdraw if amount exceeds balance - locked token', async function () {
        // Stake token
        await mockWsi.connect(bob).approve(contract.address, parseEther('100'))
        await contract.connect(bob).stake(
          parseEther('1'),
          364,
          true
        )

        // Assert
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('101'))

        // Act
        await expect(
          contract.connect(alice).emergencyWithdrawToken(mockWsi.address, parseEther('101'))
        ).to.be.revertedWith('Staking Pool: Withdraw amount exceeds available balance')
      })
    })
  })

})