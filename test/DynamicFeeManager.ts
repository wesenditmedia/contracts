import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import chai from 'chai'
import { ethers, network } from 'hardhat'
import { setBalance } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { DynamicFeeManager, MockERC20, MockFeeReceiver__factory, MockPancakePair, MockPancakePair__factory, MockPancakeRouter, MockPancakeRouter__factory, WeSenditToken, WeSenditToken__factory } from "../typechain";
import { FakeContract, MockContract, smock } from '@defi-wonderland/smock';
import { MockFeeReceiver } from "../typechain/MockFeeReceiver";
import { BigNumber, BigNumberish } from "ethers";
import { parseEther as etherParseEther } from "ethers/lib/utils";
import moment from 'moment'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'

chai.should();
chai.use(smock.matchers);

const WILDCARD_ADDRESS = '0x000000000000000000000000000000000000dEaD'

export const getFeeEntryArgs = (args?: {
  from?: string,
  to?: string,
  percentage?: BigNumberish,
  destination?: string,
  excludeContracts?: boolean,
  doLiquify?: boolean,
  doSwapForBusd?: boolean,
  swapOrLiquifyAmount?: BigNumberish,
  expiresAt?: BigNumberish
}): Parameters<typeof DynamicFeeManager.prototype.addFee> => {
  return [
    args?.from ?? WILDCARD_ADDRESS,
    args?.to ?? WILDCARD_ADDRESS,
    args?.percentage ?? 0,
    args?.destination ?? ethers.constants.AddressZero,
    args?.excludeContracts ?? false,
    args?.doLiquify ?? false,
    args?.doSwapForBusd ?? false,
    args?.swapOrLiquifyAmount ?? 0,
    args?.expiresAt ?? 0
  ]
}

const getBlockTimestamp = async () => {
  const blockNum = await ethers.provider.getBlockNumber()
  const block = await ethers.provider.getBlock(blockNum)

  return block.timestamp
}

const parseEther = (value: number | string) => {
  if (typeof value === 'string') {
    return etherParseEther(value)
  } else {
    return etherParseEther(value.toString())
  }
}

describe("Dynamic Fee Manager", function () {
  let contract: DynamicFeeManager

  let mockBnb: MockERC20
  let mockWsi: MockContract<WeSenditToken>
  let mockBusd: MockERC20
  let mockPancakePairBnb: MockContract<MockPancakePair>;
  let mockPancakePairBusd: MockContract<MockPancakePair>;
  let mockPancakeRouter: MockContract<MockPancakeRouter>;
  let fakePancakeRouter: FakeContract<MockPancakeRouter>;
  let mockFeeReceiver: MockContract<MockFeeReceiver>

  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;
  let feeReceiver: SignerWithAddress;
  let addrs: SignerWithAddress[];

  let ADMIN_ROLE: string
  let FEE_WHITELIST_ROLE: string
  let RECEIVER_FEE_WHITELIST_ROLE: string
  let BYPASS_SWAP_AND_LIQUIFY_ROLE: string
  let EXCLUDE_WILDCARD_FEE_ROLE: string
  let CALL_REFLECT_FEES_ROLE: string

  let INITIAL_FEE_PERCENTAGE_LIMIT: BigNumber
  let INITIAL_TRANSACTION_FEE_LIMIT: BigNumber
  let FEE_PERCENTAGE_LIMIT: BigNumber
  let TRANSACTION_FEE_LIMIT: BigNumber

  const FEE_DIVIDER = BigNumber.from(100000)

  beforeEach(async function () {
    [owner, alice, bob, charlie, feeReceiver, ...addrs] = await ethers.getSigners();

    const WeSenditToken = await smock.mock<WeSenditToken__factory>('WeSenditToken')
    mockWsi = await WeSenditToken.deploy(owner.address)

    const MockERC20 = await ethers.getContractFactory('MockERC20')
    mockBnb = await MockERC20.deploy()
    mockBusd = await MockERC20.deploy()

    const DynamicFeeManager = await ethers.getContractFactory("DynamicFeeManager")
    contract = await DynamicFeeManager.deploy(mockWsi.address)

    const MockPancakePair = await smock.mock<MockPancakePair__factory>('MockPancakePair')
    mockPancakePairBnb = await MockPancakePair.deploy()
    mockPancakePairBusd = await MockPancakePair.deploy()

    const MockPancakeRouter = await smock.mock<MockPancakeRouter__factory>('MockPancakeRouter')
    mockPancakeRouter = await MockPancakeRouter.deploy(
      mockBnb.address,
      mockBusd.address,
      mockWsi.address,
      mockPancakePairBnb.address,
      mockPancakePairBusd.address
    )
    fakePancakeRouter = await smock.fake(mockPancakeRouter)

    const MockFeeReceiver = await smock.mock<MockFeeReceiver__factory>('MockFeeReceiver')
    mockFeeReceiver = await MockFeeReceiver.deploy()

    ADMIN_ROLE = await contract.ADMIN()
    FEE_WHITELIST_ROLE = await contract.FEE_WHITELIST()
    RECEIVER_FEE_WHITELIST_ROLE = await contract.RECEIVER_FEE_WHITELIST()
    BYPASS_SWAP_AND_LIQUIFY_ROLE = await contract.BYPASS_SWAP_AND_LIQUIFY()
    EXCLUDE_WILDCARD_FEE_ROLE = await contract.EXCLUDE_WILDCARD_FEE()
    CALL_REFLECT_FEES_ROLE = await contract.CALL_REFLECT_FEES()

    INITIAL_FEE_PERCENTAGE_LIMIT = await contract.INITIAL_FEE_PERCENTAGE_LIMIT()
    INITIAL_TRANSACTION_FEE_LIMIT = await contract.INITIAL_TRANSACTION_FEE_LIMIT()
    FEE_PERCENTAGE_LIMIT = await contract.FEE_PERCENTAGE_LIMIT()
    TRANSACTION_FEE_LIMIT = await contract.TRANSACTION_FEE_LIMIT()

    await mockWsi.unpause()
    await mockWsi.setDynamicFeeManager(contract.address)

    await contract.setFeesEnabled(true)
    await contract.setPancakeRouter(mockPancakeRouter.address)
    await contract.setBusdAddress(mockBusd.address)
    await contract.grantRole(EXCLUDE_WILDCARD_FEE_ROLE, mockPancakePairBnb.address)
    await contract.grantRole(CALL_REFLECT_FEES_ROLE, mockWsi.address)
  });

  describe("Deployment", function () {
    it("should set the right owner", async function () {
      expect(await contract.owner()).to.equal(owner.address)
    });

    it("should assign correct initial values", async function () {
      expect(await contract.feesEnabled()).to.equal(true)
      expect(await contract.pancakeRouter()).to.equal(mockPancakeRouter.address)
      expect(await contract.busdAddress()).to.equal(mockBusd.address)
      expect(await contract.feePercentageLimit()).to.equal(INITIAL_FEE_PERCENTAGE_LIMIT)
      expect(await contract.transactionFeeLimit()).to.equal(INITIAL_TRANSACTION_FEE_LIMIT)
      expect(await contract.percentageVolumeSwap()).to.equal(0)
      expect(await contract.percentageVolumeLiquify()).to.equal(0)
      expect(await contract.pancakePairBusdAddress()).to.equal(ethers.constants.AddressZero)
      expect(await contract.pancakePairBnbAddress()).to.equal(ethers.constants.AddressZero)
    })

    it("should assign correct roles to creator", async function () {
      expect(await contract.hasRole(ADMIN_ROLE, owner.address)).to.equal(true)

      expect(await contract.getRoleAdmin(ADMIN_ROLE)).to.equal(ADMIN_ROLE)
      expect(await contract.getRoleAdmin(FEE_WHITELIST_ROLE)).to.equal(ADMIN_ROLE)
      expect(await contract.getRoleAdmin(RECEIVER_FEE_WHITELIST_ROLE)).to.equal(ADMIN_ROLE)
      expect(await contract.getRoleAdmin(BYPASS_SWAP_AND_LIQUIFY_ROLE)).to.equal(ADMIN_ROLE)
      expect(await contract.getRoleAdmin(EXCLUDE_WILDCARD_FEE_ROLE)).to.equal(ADMIN_ROLE)
      expect(await contract.getRoleAdmin(CALL_REFLECT_FEES_ROLE)).to.equal(ADMIN_ROLE)
    })

    it('should decrease fee limits', async function () {
      // Assert
      expect(await contract.feeDecreased()).to.equal(false)
      expect(await contract.feePercentageLimit()).to.equal(INITIAL_FEE_PERCENTAGE_LIMIT)
      expect(await contract.transactionFeeLimit()).to.equal(INITIAL_TRANSACTION_FEE_LIMIT)

      // Act
      await contract.decreaseFeeLimits()

      // Assert
      expect(await contract.feeDecreased()).to.equal(true)
      expect(await contract.feePercentageLimit()).to.equal(FEE_PERCENTAGE_LIMIT)
      expect(await contract.transactionFeeLimit()).to.equal(TRANSACTION_FEE_LIMIT)
    })

    it('should not decrease fee twice', async function () {
      // Arrange
      await contract.decreaseFeeLimits()

      // Act & Assert
      await expect(
        contract.decreaseFeeLimits()
      ).to.be.revertedWith('DynamicFeeManager: Fee limits are already decreased')
    })

    it('should not set Pancakeswap router to zero address', async function () {
      await expect(
        contract.setPancakeRouter(ethers.constants.AddressZero)
      ).to.be.revertedWith('DynamicFeeManager: Cannot set Pancake Router to zero address')
    })

    it('should not set BUSD to zero address', async function () {
      await expect(
        contract.setBusdAddress(ethers.constants.AddressZero)
      ).to.be.revertedWith('DynamicFeeManager: Cannot set BUSD to zero address')
    })

    it('should not set Pancakeswap BUSD pair to zero address', async function () {
      await expect(
        contract.setPancakePairBusdAddress(ethers.constants.AddressZero)
      ).to.be.revertedWith('DynamicFeeManager: Cannot set BUSD pair to zero address')
    })

    it('should not set Pancakeswap BNB pair to zero address', async function () {
      await expect(
        contract.setPancakePairBnbAddress(ethers.constants.AddressZero)
      ).to.be.revertedWith('DynamicFeeManager: Cannot set BNB pair to zero address')
    })

    it('should set percentage volume swap to 100', async function () {
      await expect(
        contract.setPercentageVolumeSwap(100)
      ).to.not.be.reverted
    })

    it('should set percentage volume liquify to 100', async function () {
      await expect(
        contract.setPercentageVolumeLiquify(100)
      ).to.not.be.reverted
    })

    it('should not set percentage volume swap to greater than 100', async function () {
      await expect(
        contract.setPercentageVolumeSwap(101)
      ).to.be.revertedWith('DynamicFeeManager: Invalid percentage volume swap value')
    })

    it('should not set percentage volume liquify to greater than 100', async function () {
      await expect(
        contract.setPercentageVolumeLiquify(101)
      ).to.be.revertedWith('DynamicFeeManager: Invalid percentage volume liquify value')
    })
  });

  describe('Dynamic Fee Management', function () {
    beforeEach(async function () {
      await contract.decreaseFeeLimits()
    })

    describe('Add Fee', function () {
      it('should add single fee', async function () {
        // Arrange & Assert
        const res = await contract.addFee(...getFeeEntryArgs())

        expect(res.value).to.equal(0)
      })

      it('should fail to add fee if percentage is over fee limit', async function () {
        // Arrange & Assert
        await expect(contract.addFee(...getFeeEntryArgs({
          percentage: FEE_PERCENTAGE_LIMIT.add(1)
        }))).to.be.revertedWith('DynamicFeeManager: Fee percentage exceeds limit')
      })

      it('should fail to add fee if percentage is over 100%', async function () {
        // Arrange & Assert
        await expect(contract.addFee(...getFeeEntryArgs({
          percentage: 100001 // 100.001%
        }))).to.be.revertedWith('DynamicFeeManager: Fee percentage exceeds limit')
      })

      it('should fail to add fee if liquify and swap is enabled', async function () {
        // Arrange & Assert
        await expect(contract.addFee(...getFeeEntryArgs({
          doLiquify: true,
          doSwapForBusd: true
        }))).to.be.revertedWith('DynamicFeeManager: Cannot enable liquify and swap at the same time')
      })

      it('should add multiple fee with same ids', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: alice.address }))
        await contract.addFee(...getFeeEntryArgs({ destination: alice.address }))
        await contract.addFee(...getFeeEntryArgs({ destination: alice.address }))

        // Assert
        const feeOne = await contract.getFee(0)
        const feeTwo = await contract.getFee(1)
        const feeThree = await contract.getFee(2)

        expect(feeOne.id).to.equal(feeTwo.id)
        expect(feeOne.id).to.equal(feeThree.id)

        expect(feeTwo.id).to.equal(feeOne.id)
        expect(feeTwo.id).to.equal(feeThree.id)

        expect(feeThree.id).to.equal(feeOne.id)
        expect(feeThree.id).to.equal(feeTwo.id)
      })

      it('should add multiple fee with different ids', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 1, destination: alice.address }))
        await contract.addFee(...getFeeEntryArgs({ percentage: 2, destination: bob.address }))
        await contract.addFee(...getFeeEntryArgs({ percentage: 3, destination: charlie.address }))

        // Assert
        const feeOne = await contract.getFee(0)
        expect(feeOne.percentage).to.equal(1)

        const feeTwo = await contract.getFee(1)
        expect(feeTwo.percentage).to.equal(2)

        const feeThree = await contract.getFee(2)
        expect(feeThree.percentage).to.equal(3)

        expect(feeOne.id).to.not.equal(feeTwo.id)
        expect(feeOne.id).to.not.equal(feeThree.id)

        expect(feeTwo.id).to.not.equal(feeOne.id)
        expect(feeTwo.id).to.not.equal(feeThree.id)

        expect(feeThree.id).to.not.equal(feeOne.id)
        expect(feeThree.id).to.not.equal(feeTwo.id)
      })

      it('should emit event on fee addition', async function () {
        // Act & Assert
        await expect(
          contract.addFee(...getFeeEntryArgs({ percentage: 1, destination: alice.address }))
        ).to
          .emit(contract, 'FeeAdded')
          .withArgs(
            anyValue,
            WILDCARD_ADDRESS,
            WILDCARD_ADDRESS,
            1,
            alice.address,
            false,
            false,
            false,
            0,
            0
          )
      })

      it('should fail to add fee as non-owner', async function () {
        // Arrange & Assert
        await expect(
          contract.connect(alice).addFee(...getFeeEntryArgs())
        ).to.be.reverted
      })

      it('should fail to add more than MAX_FEE_AMOUNT fee entries', async function () {
        // Arrange
        const MAX_FEE_AMOUNT = await contract.MAX_FEE_AMOUNT()

        for (let i = 0; i < MAX_FEE_AMOUNT.toNumber(); i++) {
          await contract.addFee(...getFeeEntryArgs({ percentage: 1, destination: alice.address }))
        }

        // Act & Assert
        await expect(
          contract.addFee(...getFeeEntryArgs({ percentage: 1, destination: alice.address }))
        ).to.be.revertedWith('DynamicFeeManager: Amount of max. fees reached')
      })
    })

    describe('Get Fee', function () {
      it('should get fee at index (1)', async function () {
        // Arrange
        await contract.addFee(
          ...getFeeEntryArgs({
            from: alice.address,
            to: bob.address,
            percentage: 1234,
            destination: addrs[0].address,
            excludeContracts: true,
            doLiquify: true,
            doSwapForBusd: false,
            swapOrLiquifyAmount: 5678,
            expiresAt: 9123
          })
        )

        // Assert
        const fee = await contract.getFee(0)
        expect(fee.id).to.be.string
        expect(fee.from).to.equal(alice.address)
        expect(fee.to).to.equal(bob.address)
        expect(fee.percentage).to.equal(1234)
        expect(fee.destination).to.equal(addrs[0].address)
        expect(fee.excludeContracts).to.be.true
        expect(fee.doLiquify).to.be.true
        expect(fee.doSwapForBusd).to.be.false
        expect(fee.swapOrLiquifyAmount).to.equal(5678)
        expect(fee.expiresAt).to.equal(9123)
      })

      it('should get fee at index (2)', async function () {
        // Arrange
        await contract.addFee(
          ...getFeeEntryArgs({
            from: alice.address,
            to: bob.address,
            percentage: 1234,
            destination: addrs[0].address,
            excludeContracts: true,
            doLiquify: false,
            doSwapForBusd: true,
            swapOrLiquifyAmount: 5678,
            expiresAt: 9123
          })
        )

        // Assert
        const fee = await contract.getFee(0)
        expect(fee.id).to.be.string
        expect(fee.from).to.equal(alice.address)
        expect(fee.to).to.equal(bob.address)
        expect(fee.percentage).to.equal(1234)
        expect(fee.destination).to.equal(addrs[0].address)
        expect(fee.excludeContracts).to.be.true
        expect(fee.doLiquify).to.be.false
        expect(fee.doSwapForBusd).to.be.true
        expect(fee.swapOrLiquifyAmount).to.equal(5678)
        expect(fee.expiresAt).to.equal(9123)
      })
    })

    describe('Remove Fee', function () {
      it('should remove fee at index as owner', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs())

        // Act & Assert
        await expect(contract.removeFee(0)).to.not.be.reverted

        // Assert
        await expect(contract.getFee(0)).to.be.reverted
      })

      it('should fail to remove fee at index as non-owner', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs())

        // Assert
        await expect(contract.connect(alice).removeFee(0)).to.be.reverted
      })

      it('should fail to remove fee at non existing index', async function () {
        // Assert
        await expect(contract.removeFee(0)).to.be.reverted
        await expect(contract.removeFee(1)).to.be.reverted
        await expect(contract.removeFee(2)).to.be.reverted
      })

      it('should remove fee if multiple fees added', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 1 }))
        await contract.addFee(...getFeeEntryArgs({ percentage: 2 }))
        await contract.addFee(...getFeeEntryArgs({ percentage: 3 }))

        // Assert
        const feeBefore = await contract.getFee(1)
        expect(feeBefore.percentage).to.equal(2)

        // Act
        await contract.removeFee(1)

        // Assert
        const feeAfter = await contract.getFee(1)
        expect(feeAfter.percentage).to.equal(3)
        await expect(contract.getFee(2)).to.be.reverted
      })

      it('should remove all fee if multiple fees added (1)', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 1 }))
        await contract.addFee(...getFeeEntryArgs({ percentage: 2 }))
        await contract.addFee(...getFeeEntryArgs({ percentage: 3 }))

        // Act & Assert
        await expect(contract.removeFee(2)).to.not.be.reverted
        await expect(contract.removeFee(1)).to.not.be.reverted
        await expect(contract.removeFee(0)).to.not.be.reverted

        // Assert
        await expect(contract.getFee(0)).to.be.reverted
        await expect(contract.getFee(1)).to.be.reverted
        await expect(contract.getFee(2)).to.be.reverted
      })

      it('should remove all fee if multiple fees added (2)', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 1 }))
        await contract.addFee(...getFeeEntryArgs({ percentage: 2 }))
        await contract.addFee(...getFeeEntryArgs({ percentage: 3 }))

        // Act & Assert
        await expect(contract.removeFee(0)).to.not.be.reverted
        await expect(contract.removeFee(0)).to.not.be.reverted
        await expect(contract.removeFee(0)).to.not.be.reverted

        // Assert
        await expect(contract.getFee(0)).to.be.reverted
        await expect(contract.getFee(1)).to.be.reverted
        await expect(contract.getFee(2)).to.be.reverted
      })

      it('should emit event on fee removal', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 1, destination: alice.address }))

        // Act & Assert
        await expect(
          contract.removeFee(0)
        ).to
          .emit(contract, 'FeeRemoved')
          .withArgs(
            anyValue,
            0
          )
      })
    })
  })

  describe('Fee Calculation', function () {
    beforeEach(async function () {
      await contract.decreaseFeeLimits()
      await mockWsi.transfer(alice.address, parseEther('100'))
      await mockWsi.connect(alice).approve(contract.address, parseEther('100'))
      await contract.grantRole(CALL_REFLECT_FEES_ROLE, owner.address)
    })

    it('should calculate correct fee for single entry', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('10'))
    })

    it('should calculate correct fee for single entry (2)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('150')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('15'))
    })

    it('should calculate correct fee for single entry (3)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('200')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('20'))
    })

    it('should calculate correct fee for single entry (4)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('0.0000025')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0.00000025'))
    })

    it('should calculate correct fee for single entry (5)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('0.00000000025')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0.000000000025'))
    })

    it('should calculate correct fee for single entry (6)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 7500 })) // 7.5%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('0.0001337')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0.0000100275'))
    })

    it('should calculate correct fee for single entry (7)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 178 })) // 0.178%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('0.0001337')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0.000000237986'))
    })

    it('should calculate correct fee for single entry (8)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1500 })) // 1.5%
      // 100 are already approved from beforeEach, add the missing 123456689 for the transaction amount
      await mockWsi.transfer(alice.address, parseEther('123456689'))
      await mockWsi.connect(alice).approve(contract.address, parseEther('123456689'))

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('123456789')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('1851851.835'))
    })

    for (const amount of [1, 10]) {
      it(`should calculate correct fee for small amount (${amount})`, async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 })) // 1%

        // Act
        await contract.reflectFees(
          alice.address,
          bob.address,
          amount
        )

        // Assert
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(0)
      })
    }

    for (const percentage of [1, 10, 100, 1000, 10000]) {
      for (const amount of [1, 10, 100, 1000, 10000, 1000000]) {
        it(`should calculate correct fee for percentage: ${percentage / FEE_DIVIDER.toNumber()}% and amount: ${amount}`, async function () {
          // Arrange
          await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage }))

          // Act
          await contract.reflectFees(
            alice.address,
            bob.address,
            amount
          )

          // Assert
          if ((amount * percentage / FEE_DIVIDER.toNumber()) >= 1) {
            expect(await mockWsi.balanceOf(addrs[0].address)).to.not.equal(0)
          } else {
            expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(0)
          }
        })
      }
    }

    it('should calculate correct fee for multiple entries', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 })) // 1%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 500 })) // 0.5%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('1.5'))
    })

    it('should calculate correct fee for relevant entries (1)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 })) // 1%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, to: bob.address, percentage: 500 })) // 0.5%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('1.5'))
    })

    it('should calculate correct fee for relevant entries (2)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 })) // 1%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, from: bob.address, percentage: 500 })) // 0.5%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('1'))
    })

    it('should calculate correct fee for relevant entries (3)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 500 })) // 0.5%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, from: bob.address, percentage: 1000 })) // 1%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0.5'))
    })

    it('should calculate correct fee for relevant entries (4)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 })) // 1%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, from: bob.address, percentage: 500 })) // 0.5%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, from: alice.address, percentage: 750 })) // 0.75%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, to: bob.address, percentage: 250 })) // 0.25%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('2'))
    })

    it('should calculate correct fee for relevant entries (5)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 })) // 1%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, from: alice.address, percentage: 500 })) // 0.5%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, from: alice.address, percentage: 750 })) // 0.75%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, to: bob.address, percentage: 250 })) // 0.25%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('2.5'))
    })

    it('should calculate correct fee for relevant entries (6)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 100 })) // 0.1%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, from: alice.address, percentage: 250 })) // 0.25%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, from: alice.address, percentage: 750 })) // 0.75%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, to: bob.address, percentage: 250 })) // 0.25%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 100 })) // 1%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, to: bob.address, percentage: 100 })) // 0.1%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, to: bob.address, percentage: 150 })) // 0.15%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('1.7'))
    })

    it('should calculate correct fee for relevant entries (7)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 })) // 1%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, from: alice.address, percentage: 500 })) // 0.5%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, from: alice.address, percentage: 750 })) // 0.75%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, to: bob.address, percentage: 250 })) // 0.25%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('0.0002')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0.0000050'))
    })

    it('should calculate fee if overall fee is equal transaction fee limit', async function () {
      // Arrange
      const percentage = TRANSACTION_FEE_LIMIT.div(2)
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage }))
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage }))

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(
        parseEther('100').mul(TRANSACTION_FEE_LIMIT).div(FEE_DIVIDER)
      )
    })

    it('should calculate fee partially if overall fee is higher than transaction fee limit (1)', async function () {
      // Arrange
      const percentage = TRANSACTION_FEE_LIMIT.div(2)
      const amount = parseEther('100').mul(percentage).div(FEE_DIVIDER)
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage }))
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: percentage.add(1) }))

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(
        amount
      )
    })

    it('should calculate fee partially if overall fee is higher than transaction fee limit (2)', async function () {
      // Arrange
      const percentage = TRANSACTION_FEE_LIMIT.div(4)
      const amount = parseEther('100').mul(percentage).div(FEE_DIVIDER)
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage }))
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage }))
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage }))
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: percentage.add(1) }))

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(
        amount.mul(3)
      )
    })

    it('should calculate fee partially if overall fee is higher than transaction fee limit (3)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(
        parseEther('10')
      )
    })

    it('should calculate fee partially if overall fee is higher than transaction fee limit (4)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2000 })) // 2%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(
        parseEther('9.5')
      )
    })

    it('should calculate correct fee for single time relevant entry', async function () {
      // Arrange
      const blockTimestamp = await getBlockTimestamp()
      const expiresAt = moment.unix(blockTimestamp).add(10, 'seconds').unix()

      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000, expiresAt })) // 10%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('10'))
    })

    it('should calculate correct fee for time relevant entries (1)', async function () {
      // Arrange
      const blockTimestamp = await getBlockTimestamp()
      const expiresAt = moment.unix(blockTimestamp).add(10, 'seconds').unix()

      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000, expiresAt })) // 1%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 500, expiresAt: blockTimestamp })) // 0.5%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 750, expiresAt: blockTimestamp })) // 0.75%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, to: bob.address, percentage: 250, expiresAt })) // 0.25%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('1.25'))
    })

    it('should calculate correct fee for time relevant entries (2)', async function () {
      // Arrange
      const blockTimestamp = await getBlockTimestamp()
      const expiresAt = moment.unix(blockTimestamp).add(10, 'seconds').unix()

      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000, expiresAt })) // 1%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 500, expiresAt })) // 0.5%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 750, expiresAt })) // 0.75%
      await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, to: bob.address, percentage: 250, expiresAt })) // 0.25%

      // Act
      await contract.reflectFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('2.5'))
    })
  })

  describe('Fee Refelection', function () {

    beforeEach(async function () {
      await contract.decreaseFeeLimits()
      await mockWsi.transfer(alice.address, parseEther('100'))
      await mockWsi.connect(alice).approve(contract.address, parseEther('100'))
      await contract.grantRole(CALL_REFLECT_FEES_ROLE, alice.address)

      await contract.setPancakeRouter(fakePancakeRouter.address)
    })

    describe('Basic Fees', function () {
      it('should reflect single fee', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(mockWsi.transferFromNoFees).to.have.been.calledOnce
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('90'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('10'))
      })

      it('should reflect multiple fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 })) // 1%
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 250 })) // 0.25%
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 500 })) // 0.5%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(mockWsi.transferFromNoFees).to.have.been.calledThrice
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('98.25'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('1.75'))
      })

      it('should reflect relevant fees (1)', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 })) // 1% (matches)
        await contract.addFee(...getFeeEntryArgs({ from: bob.address, destination: addrs[0].address, percentage: 100 })) // 0.1%
        await contract.addFee(...getFeeEntryArgs({ to: bob.address, destination: addrs[0].address, percentage: 250 })) // 0.25% (matches)
        await contract.addFee(...getFeeEntryArgs({ from: alice.address, destination: addrs[0].address, percentage: 350 })) // 0.35% (matches)
        await contract.addFee(...getFeeEntryArgs({ to: alice.address, destination: addrs[0].address, percentage: 450 })) // 0.45%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(mockWsi.transferFromNoFees).to.have.been.calledThrice
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('98.4'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('1.6'))
      })

      it('should reflect relevant fees (2)', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 })) // 1% (matches)
        await contract.addFee(...getFeeEntryArgs({ from: alice.address, to: bob.address, destination: addrs[0].address, percentage: 100 })) // 0.1% (matches)
        await contract.addFee(...getFeeEntryArgs({ from: bob.address, destination: addrs[0].address, percentage: 100 })) // 0.1%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(mockWsi.transferFromNoFees).to.have.been.calledTwice
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('98.9'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('1.1'))
      })

      for (const amount of [1, 10]) {
        it(`should not reflect fee if fee amount is zero (${amount})`, async function () {
          // Arrange
          await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 })) // 1%

          // Act
          await contract.connect(alice).reflectFees(
            alice.address,
            bob.address,
            amount
          )

          // Assert
          expect(mockWsi.transferFromNoFees).to.have.not.been.called
          expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('100'))
          expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0'))
        })
      }

      it('should not reflect fee if sender is owner', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10%
        await contract.transferOwnership(alice.address)

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(mockWsi.transferFromNoFees).to.have.not.been.called
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('100'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0'))
      })

      it('should not reflect fee if sender has admin role', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10%
        await contract.grantRole(ADMIN_ROLE, alice.address)

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(mockWsi.transferFromNoFees).to.have.not.been.called
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('100'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0'))
      })

      it('should not reflect fee if sender has fee whitelist role', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10%
        await contract.grantRole(FEE_WHITELIST_ROLE, alice.address)

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(mockWsi.transferFromNoFees).to.have.not.been.called
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('100'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0'))
      })

      it('should not reflect fee if receiver has fee receiver whitelist role', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10%
        await contract.grantRole(RECEIVER_FEE_WHITELIST_ROLE, bob.address)

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(mockWsi.transferFromNoFees).to.have.not.been.called
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('100'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0'))
      })

      it('should reflect fee if sender is contract', async function () {
        // Arrange
        await contract.grantRole(CALL_REFLECT_FEES_ROLE, mockFeeReceiver.address)

        // Impersonate mock contract
        const contractSigner = await ethers.getSigner(mockFeeReceiver.address);

        // Send ETH to be able to make calls
        await owner.sendTransaction({
          to: contractSigner.address,
          value: ethers.utils.parseEther("10.0"),
        })

        // Transfer token to mock contract
        await mockWsi.transfer(mockFeeReceiver.address, parseEther('100'))
        await mockWsi.connect(contractSigner).approve(contract.address, parseEther('100'))

        // Add wallet-to-wallet fee
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000, excludeContracts: false })) // 10%

        // Act
        await contract.connect(contractSigner).reflectFees(
          contractSigner.address,
          alice.address,
          parseEther('100')
        )

        // Assert
        expect(mockWsi.transferFromNoFees).to.have.been.called
        expect(await mockWsi.balanceOf(contractSigner.address)).to.equal(parseEther('90'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('10'))
      })

      it('should not reflect fee if sender is contract', async function () {
        // Arrange
        await contract.grantRole(CALL_REFLECT_FEES_ROLE, mockFeeReceiver.address)

        // Impersonate mock contract
        const contractSigner = await ethers.getSigner(mockFeeReceiver.address);

        // Send ETH to be able to make calls
        await owner.sendTransaction({
          to: contractSigner.address,
          value: ethers.utils.parseEther("10.0"),
        })

        // Transfer token to mock contract
        await mockWsi.transfer(mockFeeReceiver.address, parseEther('100'))
        await mockWsi.connect(contractSigner).approve(contract.address, parseEther('100'))

        // Add wallet-to-wallet fee
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000, excludeContracts: true })) // 10%

        // Act
        await contract.connect(contractSigner).reflectFees(
          contractSigner.address,
          alice.address,
          parseEther('100')
        )

        // Assert
        expect(mockWsi.transferFromNoFees).to.have.not.been.called
        expect(await mockWsi.balanceOf(contractSigner.address)).to.equal(parseEther('100'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0'))
      })

      it('should emit event on fee reflection', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10%

        // Act & Assert
        await expect(
          contract.connect(alice).reflectFees(
            alice.address,
            bob.address,
            parseEther('100')
          )
        ).to
          .emit(contract, 'FeeReflected')
          .withArgs(
            anyValue,
            mockWsi.address,
            alice.address,
            bob.address,
            parseEther('10'),
            addrs[0].address,
            false,
            false,
            false,
            0,
            0
          )
      })

      it('should reflect fee if overall fee is equal transaction fee limit', async function () {
        // Arrange
        const percentage = TRANSACTION_FEE_LIMIT.div(2)
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage }))
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage }))

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(mockWsi.transferFromNoFees).to.have.been.calledTwice
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('90'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('10'))
      })

      it('should reflect fee partially if overall fee is higher than transaction fee limit (1)', async function () {
        // Arrange
        const percentage = TRANSACTION_FEE_LIMIT.div(2)
        const amount = parseEther('100').mul(percentage).div(FEE_DIVIDER)
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage }))
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: percentage.add(1) }))

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(
          amount
        )
      })

      it('should reflect fee partially if overall fee is higher than transaction fee limit (2)', async function () {
        // Arrange
        const percentage = TRANSACTION_FEE_LIMIT.div(4)
        const amount = parseEther('100').mul(percentage).div(FEE_DIVIDER)
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage }))
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage }))
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage }))
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: percentage.add(1) }))

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(
          amount.mul(3)
        )
      })

      it('should reflect fee partially if overall fee is higher than transaction fee limit (3)', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(
          parseEther('10')
        )
      })

      it('should reflect fee partially if overall fee is higher than transaction fee limit (4)', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2000 })) // 2%
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(
          parseEther('9.5')
        )
      })

      it('should fail to reflect fee if caller has no CALL_REFLECT_FEES role', async function () {
        // Arrange
        await contract.revokeRole(CALL_REFLECT_FEES_ROLE, alice.address)

        // Act & Assert
        await expect(contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )).to.be.reverted
      })

      it('should fail to reflect fee if token transfer fails', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 }))
        mockWsi.transferFromNoFees.returns(false)

        // Act & Assert
        await expect(contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )).to.be.revertedWith('DynamicFeeManager: Fee transfer to destination failed')
      })

      it('should fail to reflect fee if amount is zero', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 }))

        // Act & Assert
        await expect(contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          0
        )).to.be.revertedWith('DynamicFeeManager: invalid total amount')
      })
    })

    /**describe('Fees with callback', function () {
      it('should reflect single fee and call callback', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, excludeContracts: true })) // 10%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(mockFeeReceiver.onERC20Received).to.have.been.calledOnce
        expect(mockFeeReceiver.onERC20Received).to.have.been.calledWith(
          contract.address,
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('10')
        )
      })

      it('should reflect multiple fees and call callbacks', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 1000, excludeContracts: true })) // 1%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 250, excludeContracts: true })) // 0.25%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 500, excludeContracts: true })) // 0.5%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(mockFeeReceiver.onERC20Received).to.have.been.calledThrice

        expect(mockFeeReceiver.onERC20Received).to.have.been.calledWith(
          contract.address,
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('1')
        )

        expect(mockFeeReceiver.onERC20Received).to.have.been.calledWith(
          contract.address,
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('0.25')
        )

        expect(mockFeeReceiver.onERC20Received).to.have.been.calledWith(
          contract.address,
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('0.5')
        )
      })

      it('should reflect relevant fees and call callbacks', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 1000, excludeContracts: true })) // 1% (matches)
        await contract.addFee(...getFeeEntryArgs({ from: bob.address, destination: mockFeeReceiver.address, percentage: 150, excludeContracts: true })) // 0.15%
        await contract.addFee(...getFeeEntryArgs({ to: bob.address, destination: mockFeeReceiver.address, percentage: 250, excludeContracts: true })) // 0.25% (matches)
        await contract.addFee(...getFeeEntryArgs({ from: alice.address, destination: mockFeeReceiver.address, percentage: 350, excludeContracts: false })) // 0.35% (matches, no callback)
        await contract.addFee(...getFeeEntryArgs({ to: alice.address, destination: mockFeeReceiver.address, percentage: 450, excludeContracts: true })) // 0.45%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(mockFeeReceiver.onERC20Received).to.have.been.calledTwice

        expect(mockFeeReceiver.onERC20Received).to.have.been.calledWith(
          contract.address,
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('1')
        )

        expect(mockFeeReceiver.onERC20Received).to.have.been.calledWith(
          contract.address,
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('0.25')
        )
      })

      it('should not reflect single fee and call callback if destination is contract and not implements IFeeReceiver', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockWsi.address, percentage: 10000, excludeContracts: true })) // 10%

        // Act & Assert
        await expect(contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )).to.not.be.reverted
      })
    })*/

    describe('Fees with liquify', function () {
      it('should collect liquidation amount for single fee', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('11') })) // 10%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('10'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('10'))
      })

      it('should collect liquidation amount for multiple same fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 1000, doLiquify: true, swapOrLiquifyAmount: parseEther('2.1') })) // 1%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 1000, doLiquify: true, swapOrLiquifyAmount: parseEther('2.1') })) // 1%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('2'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('2'))
      })

      it('should collect liquidation amount for multiple different fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 1000, doLiquify: true, swapOrLiquifyAmount: parseEther('1.1') })) // 1%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 1000, doLiquify: true, swapOrLiquifyAmount: parseEther('2.1') })) // 1%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('2'))

        const feeOne = await contract.getFee(0)
        expect(await contract.getFeeAmount(feeOne.id)).to.equal(parseEther('1'))

        const feeTwo = await contract.getFee(1)
        expect(await contract.getFeeAmount(feeTwo.id)).to.equal(parseEther('1'))
      })

      it('should collect liquidation amount for multiple transactions with single fee', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('8') })) // 10%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('50')
        )

        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('25')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('7.5'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('7.5'))
      })

      it('should add liquidy if amount is reached for single fee', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: feeReceiver.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('10') })) // 10%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledOnce
        expect(fakePancakeRouter.addLiquidityETH).to.be.calledOnce
        expect(fakePancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('5'),
          0,
          0,
          feeReceiver.address,
          await getBlockTimestamp()
        )
      })

      it('should add liquidy if amount is reached for multiple same fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: feeReceiver.address, percentage: 1000, doLiquify: true, swapOrLiquifyAmount: parseEther('1.2') })) // 1%
        await contract.addFee(...getFeeEntryArgs({ destination: feeReceiver.address, percentage: 1000, doLiquify: true, swapOrLiquifyAmount: parseEther('1.2') })) // 1%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledOnce
        expect(fakePancakeRouter.addLiquidityETH).to.be.calledOnce
        expect(fakePancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('0.6'),
          0,
          0,
          feeReceiver.address,
          await getBlockTimestamp()
        )
      })

      it('should add liquidy if amount is reached for multiple different fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 1000, doLiquify: true, swapOrLiquifyAmount: parseEther('1.0') })) // 1%
        await contract.addFee(...getFeeEntryArgs({ destination: charlie.address, percentage: 1500, doLiquify: true, swapOrLiquifyAmount: parseEther('1.5') })) // 1.5%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledTwice
        expect(fakePancakeRouter.addLiquidityETH).to.be.calledTwice
        expect(fakePancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('0.5'),
          0,
          0,
          bob.address,
          await getBlockTimestamp()
        )

        expect(fakePancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('0.75'),
          0,
          0,
          charlie.address,
          await getBlockTimestamp()
        )
      })

      it('should add liquidy if amount is reached for one of multiple different fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 1000, doLiquify: true, swapOrLiquifyAmount: parseEther('1') })) // 1%
        await contract.addFee(...getFeeEntryArgs({ destination: charlie.address, percentage: 1000, doLiquify: true, swapOrLiquifyAmount: parseEther('2') })) // 1%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledOnce
        expect(fakePancakeRouter.addLiquidityETH).to.be.calledOnce
        expect(fakePancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('0.5'),
          0,
          0,
          bob.address,
          await getBlockTimestamp()
        )
      })

      it('should not add liquidy if sender has bypass role', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('10') })) // 10%
        await contract.grantRole(BYPASS_SWAP_AND_LIQUIFY_ROLE, alice.address)

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.not.be.called
        expect(fakePancakeRouter.addLiquidityETH).to.not.be.called
      })

      it('should not add liquidy if collected amount is lower than MIN_SWAP_OR_LIQUIFY_AMOUNT', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 5000, doLiquify: true, swapOrLiquifyAmount: 0 })) // 5%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('10')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.not.be.called
        expect(fakePancakeRouter.addLiquidityETH).to.not.be.called
      })

      it('should emit event on add liquidy', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('10') })) // 10%

        // Act & Assert
        await expect(
          contract.connect(alice).reflectFees(
            alice.address,
            bob.address,
            parseEther('100')
          )
        ).to
          .emit(contract, 'SwapAndLiquify')
          .withArgs(
            parseEther('5'),
            0,
            parseEther('5')
          )
      })
    })

    describe('Fees with swap', function () {
      it('should collect swap amount for single fee', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('11') })) // 10%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('10'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('10'))
      })

      it('should collect swap amount for multiple same fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 1000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('2.1') })) // 1%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 1000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('2.1') })) // 1%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('2'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('2'))
      })

      it('should collect swap amount for multiple different fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 1000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('1.1') })) // 1%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 1000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('2.1') })) // 1%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('2'))

        const feeOne = await contract.getFee(0)
        expect(await contract.getFeeAmount(feeOne.id)).to.equal(parseEther('1'))

        const feeTwo = await contract.getFee(1)
        expect(await contract.getFeeAmount(feeTwo.id)).to.equal(parseEther('1'))
      })

      it('should swap if amount is reached for single fee', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('10') })) // 10%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledOnce
        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('10'),
          0,
          [mockWsi.address, mockBusd.address],
          mockFeeReceiver.address,
          await getBlockTimestamp()
        )
      })

      it('should swap if amount is reached for multiple same fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 1000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('1.2') })) // 1%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 1000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('1.2') })) // 1%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledOnce
        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('1.2'),
          0,
          [mockWsi.address, mockBusd.address],
          mockFeeReceiver.address,
          await getBlockTimestamp()
        )
      })

      it('should swap if amount is reached for multiple different fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 1000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('1') })) // 1%
        await contract.addFee(...getFeeEntryArgs({ destination: charlie.address, percentage: 1500, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('1.5') })) // 1.5%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledTwice
        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('1'),
          0,
          [mockWsi.address, mockBusd.address],
          bob.address,
          await getBlockTimestamp()
        )

        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('1.5'),
          0,
          [mockWsi.address, mockBusd.address],
          charlie.address,
          await getBlockTimestamp()
        )
      })

      it('should swap if amount is reached for one of multiple different fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 1000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('1') })) // 1%
        await contract.addFee(...getFeeEntryArgs({ destination: charlie.address, percentage: 1000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('2') })) // 1%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledOnce
        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('1'),
          0,
          [mockWsi.address, mockBusd.address],
          bob.address,
          await getBlockTimestamp()
        )
      })

      it('should not swap if sender has bypass role', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('10') })) // 10%
        await contract.grantRole(BYPASS_SWAP_AND_LIQUIFY_ROLE, alice.address)

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('100')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.not.be.called
      })

      it('should not swap if collected amount is lower than MIN_SWAP_OR_LIQUIFY_AMOUNT', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 5000, doSwapForBusd: true, swapOrLiquifyAmount: 0 })) // 5%

        // Act
        await contract.connect(alice).reflectFees(
          alice.address,
          bob.address,
          parseEther('10')
        )

        // Assert
        expect(fakePancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.not.be.called
      })

      it('should emit event on add swap', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('10') })) // 10%

        // Act & Assert
        await expect(
          contract.connect(alice).reflectFees(
            alice.address,
            bob.address,
            parseEther('100')
          )
        ).to
          .emit(contract, 'SwapTokenForBusd')
          .withArgs(
            mockWsi.address,
            parseEther('10'),
            0,
            mockFeeReceiver.address
          )
      })
    })

  })

  describe('Emergency Withdraw', function () {
    describe('BNB', function () {
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

      it('should fail on withdraw if caller is non-payable', async function () {
        // Arrange
        // Use MockFeeReceiver here, because it's non-payable
        await contract.grantRole(ADMIN_ROLE, mockFeeReceiver.address)

        await ethers.provider.send('hardhat_setBalance', [
          mockFeeReceiver.address,
          '0x56BC75E2D63100000'
        ])

        await network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [mockFeeReceiver.address]
        })

        const signer = await ethers.getSigner(mockFeeReceiver.address);

        // Act & Assert
        await expect(
          contract.connect(signer).emergencyWithdraw(parseEther('100'))
        ).to.be.revertedWith('WeSendit: Failed to send BNB')

        // Reset
        await network.provider.request({
          method: 'hardhat_stopImpersonatingAccount',
          params: [mockFeeReceiver.address]
        })
      })
    })

    describe('Token', function () {
      beforeEach(async function () {
        await contract.grantRole(ADMIN_ROLE, alice.address)
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
          contract.connect(bob).emergencyWithdrawToken(mockWsi.address, parseEther('100'))
        ).to.be.reverted
      })
    })
  })

  describe('Test Scenarios', function () {
    beforeEach(async function () {
      await contract.decreaseFeeLimits()
      await contract.grantRole(EXCLUDE_WILDCARD_FEE_ROLE, mockPancakePairBusd.address)
      await contract.grantRole(EXCLUDE_WILDCARD_FEE_ROLE, mockPancakePairBnb.address)
    })

    describe('DEX', function () {
      let dexBuyLiquifyFee: any
      let dexBuySwapFee: any
      let dexSellLiquifyFee: any
      let dexSellSwapFee: any

      beforeEach(async function () {
        // Buy
        await contract.addFee(...getFeeEntryArgs({
          from: mockPancakePairBusd.address,
          percentage: 3000,
          doLiquify: true,
          swapOrLiquifyAmount: 0,
          destination: feeReceiver.address
        })) // 3% and instant liquify
        dexBuyLiquifyFee = await contract.getFee(0)

        await contract.addFee(...getFeeEntryArgs({
          from: mockPancakePairBusd.address,
          percentage: 2000,
          doSwapForBusd: true,
          swapOrLiquifyAmount: parseEther('10'),
          destination: feeReceiver.address
        })) // 2%
        dexBuySwapFee = await contract.getFee(1)

        // Sell
        await contract.addFee(...getFeeEntryArgs({
          to: mockPancakePairBusd.address,
          percentage: 2000,
          doLiquify: true,
          swapOrLiquifyAmount: 0,
          destination: feeReceiver.address
        })) // 3% and instant liquify
        dexSellLiquifyFee = await contract.getFee(0)

        await contract.addFee(...getFeeEntryArgs({
          to: mockPancakePairBusd.address,
          percentage: 3000,
          doSwapForBusd: true,
          swapOrLiquifyAmount: parseEther('10'),
          destination: feeReceiver.address
        })) // 2%
        dexSellSwapFee = await contract.getFee(1)

        // Setup pairs in Dynamic Fee Manager
        await contract.setPancakePairBnbAddress(mockPancakePairBnb.address)
        await contract.setPancakePairBusdAddress(mockPancakePairBusd.address)
        await contract.setPercentageVolumeLiquify(3)
        await contract.setPercentageVolumeSwap(3)

        // Fake pair liquidity
        await mockWsi.transfer(mockPancakePairBusd.address, parseEther('1000000'))
        await mockBusd.transfer(mockPancakePairBusd.address, parseEther('100000'))

        await mockWsi.transfer(mockPancakePairBnb.address, parseEther('1000000'))
        await mockBnb.transfer(mockPancakePairBnb.address, parseEther('100000'))

        // Send BNB to PancakeRouter mock to work correctly
        await setBalance(mockPancakeRouter.address, parseEther('100000'))
      })

      describe('Buy', function () {
        for (const txCount of [1, 2, 3, 5, 10, 20, 50, 100]) {
          const swapFee = 137 * 0.02
          const totalSwapFee = swapFee * txCount
          const totalSwaps = 0 // no swaps on buy
          const overlapAmount = totalSwapFee - (totalSwaps * 10)

          it(`should collect fees for ${txCount} transactions`, async function () {
            for (let i = 0; i < txCount; i++) {
              await mockBusd.transfer(alice.address, parseEther('137'))
              await mockBusd.connect(alice).approve(mockPancakeRouter.address, parseEther('137'))
              await mockPancakeRouter.connect(alice).swapExactTokensForTokensSupportingFeeOnTransferTokens(
                parseEther('137'),
                parseEther('137'),
                [mockBusd.address, mockWsi.address],
                alice.address,
                await getBlockTimestamp()
              )
            }

            // Assert
            expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.callCount(txCount + totalSwaps)
            expect(await contract.getFeeAmount(dexBuyLiquifyFee.id)).to.equal(0)
            expect(await contract.getFeeAmount(dexBuySwapFee.id)).to.be.closeTo(parseEther(overlapAmount), 1000000)
          })
        }
      })

      describe('Sell', function () {
        for (const txCount of [1, 2, 3, 5, 10, 20, 50, 100]) {
          const swapFee = 137 * 0.03
          const totalSwapFee = swapFee * txCount
          const totalSwaps = Math.floor(totalSwapFee / 10)
          const overlapAmount = totalSwapFee - (totalSwaps * 10)

          it(`should collect fees for ${txCount} transactions`, async function () {
            for (let i = 0; i < txCount; i++) {
              await mockWsi.transfer(alice.address, parseEther('137'))
              await mockWsi.connect(alice).approve(mockPancakeRouter.address, parseEther('137'))
              await mockPancakeRouter.connect(alice).swapExactTokensForTokensSupportingFeeOnTransferTokens(
                parseEther('137'),
                parseEther('137'),
                [mockWsi.address, mockBusd.address],
                alice.address,
                await getBlockTimestamp()
              )
            }

            // Assert
            expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.callCount(txCount + totalSwaps)
            expect(await contract.getFeeAmount(dexSellLiquifyFee.id)).to.equal(0)
            expect(await contract.getFeeAmount(dexSellSwapFee.id)).to.be.closeTo(parseEther(overlapAmount), 1000000)
          })
        }
      })
    })

    describe('Add Liquidity', function () {
      it('should liquify after threshold is reached', async function () {
        // Arrange
        await mockWsi.transfer(mockPancakePairBusd.address, parseEther('500'))
        await setBalance(mockPancakeRouter.address, parseEther('12.5'))
        await contract.addFee(...getFeeEntryArgs({ from: mockPancakePairBusd.address, percentage: 5000, destination: feeReceiver.address, doLiquify: true, swapOrLiquifyAmount: parseEther('25') })) // 5%
        await contract.addFee(...getFeeEntryArgs({ percentage: 3000, destination: feeReceiver.address })) // 3%

        for (let i = 0; i < 3; i++) {
          // Act
          await mockBusd.transfer(alice.address, parseEther('100'))
          await mockBusd.connect(alice).approve(mockPancakeRouter.address, parseEther('100'))
          await mockPancakeRouter.connect(alice).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            parseEther('100'),
            parseEther('100'),
            [mockBusd.address, mockWsi.address],
            alice.address,
            moment().add('60', 'seconds').unix()
          )
        }

        for (let i = 0; i < 1; i++) {
          // Act
          await mockBusd.transfer(bob.address, parseEther('100'))
          await mockBusd.connect(bob).approve(mockPancakeRouter.address, parseEther('100'))
          await mockPancakeRouter.connect(bob).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            parseEther('100'),
            parseEther('100'),
            [mockBusd.address, mockWsi.address],
            bob.address,
            moment().add('60', 'seconds').unix()
          )
        }

        // Assert
        expect(await mockBusd.balanceOf(mockPancakePairBusd.address)).to.equal(parseEther('400'))
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('20'))
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('285'))
        expect(await mockWsi.balanceOf(bob.address)).to.equal(parseEther('95'))
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.not.been.called
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.callCount(4)

        // Act
        await mockWsi.transfer(alice.address, parseEther('100'))
        await mockWsi.connect(alice).transfer(charlie.address, parseEther('100'))

        // Assert
        expect(await mockWsi.balanceOf(charlie.address)).to.equal(parseEther('97'))
        expect(await mockWsi.balanceOf(feeReceiver.address)).to.equal(parseEther('3'))
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.not.been.called
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.callCount(4)

        // Act
        await mockBusd.transfer(bob.address, parseEther('100'))
        await mockBusd.connect(bob).approve(mockPancakeRouter.address, parseEther('100'))
        await mockPancakeRouter.connect(bob).swapExactTokensForTokensSupportingFeeOnTransferTokens(
          parseEther('100'),
          parseEther('100'),
          [mockBusd.address, mockWsi.address],
          bob.address,
          moment().add('60', 'seconds').unix()
        )

        // Assert
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.callCount(5)
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.been.calledOnce
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('12.5'),
          0,
          [mockWsi.address, mockBnb.address],
          contract.address,
          await getBlockTimestamp()
        )

        expect(mockPancakeRouter.addLiquidityETH).to.have.been.calledOnce
        expect(mockPancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('12.5'),
          0,
          0,
          feeReceiver.address,
          await getBlockTimestamp()
        )
        expect(mockPancakeRouter.addLiquidityETH.getCall(0).value).to.equal(parseEther('12.5'))

        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('285'))
        expect(await mockWsi.balanceOf(bob.address)).to.equal(parseEther('190'))
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(mockPancakePairBnb.address)).to.equal(parseEther('25'))
        expect(await mockBusd.balanceOf(feeReceiver.address)).to.equal(parseEther('0'))
      })

      it('should liquify swapOrLiquifyAmount if percentage and Pancake Pair address is zero', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: feeReceiver.address, doLiquify: true, swapOrLiquifyAmount: parseEther('5') })) // 5%

        // Assigning WSI to Pancakepair as volume,
        // so we'd swap a maximum of two percent of the volume.
        // Example: 150 WSI * 2% = 3 WSI
        await mockWsi.transfer(mockPancakePairBnb.address, parseEther('100'))
        await setBalance(mockPancakeRouter.address, parseEther('100'))

        // Act
        await mockWsi.transfer(alice.address, parseEther('100'))
        await mockWsi.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.not.been.called
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.been.calledOnce
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('2.5'), // see percentual amount
          0,
          [mockWsi.address, mockBnb.address],
          contract.address,
          await getBlockTimestamp()
        )

        expect(mockPancakeRouter.addLiquidityETH).to.have.been.calledOnce
        expect(mockPancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('2.5'),
          0,
          0,
          feeReceiver.address,
          await getBlockTimestamp()
        )
        expect(mockPancakeRouter.addLiquidityETH.getCall(0).value).to.equal(parseEther('2.5'))

        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(bob.address)).to.equal(parseEther('95'))
        expect(await mockWsi.balanceOf(contract.address)).to.be.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(feeReceiver.address)).to.equal(parseEther('0'))
      })

      it('should liquify available fee amount if percentage and swapOrLiquify amount is zero', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: feeReceiver.address, doLiquify: true, swapOrLiquifyAmount: 0 })) // 5%
        await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: feeReceiver.address, doLiquify: true, swapOrLiquifyAmount: parseEther('100') })) // 5%
        await contract.setPercentageVolumeLiquify(0) // % of volume
        await contract.setPancakePairBnbAddress(mockPancakePairBnb.address)

        // Assigning WSI to Pancakepair as volume,
        // so we'd swap a maximum of two percent of the volume.
        // Example: 150 WSI * 2% = 3 WSI
        await mockWsi.transfer(mockPancakePairBnb.address, parseEther('100'))
        await setBalance(mockPancakeRouter.address, parseEther('100'))

        // Act
        await mockWsi.transfer(alice.address, parseEther('100'))
        await mockWsi.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.not.been.called
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.been.calledOnce
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('2.5'), // see percentual amount
          0,
          [mockWsi.address, mockBnb.address],
          contract.address,
          await getBlockTimestamp()
        )

        expect(mockPancakeRouter.addLiquidityETH).to.have.been.calledOnce
        expect(mockPancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('2.5'),
          0,
          0,
          feeReceiver.address,
          await getBlockTimestamp()
        )
        expect(mockPancakeRouter.addLiquidityETH.getCall(0).value).to.equal(parseEther('2.5'))

        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(bob.address)).to.equal(parseEther('90'))
        expect(await mockWsi.balanceOf(contract.address)).to.be.equal(parseEther('5'))
        expect(await mockWsi.balanceOf(feeReceiver.address)).to.equal(parseEther('0'))
      })

      for (const percentage of [0, 1, 2, 5, 10, 20, 50, 75, 100]) {
        for (const value of [100, 137, 150, 200, 300, 500, 1000, 1330, 1000000, 2000000, 5000000, 17011995]) {
          const minLiquifyAmount = 5
          const amount = value
          const percentualLiquifyAmount = percentage > 0 ? value * (percentage / 100) : value
          const liquifyAmount = percentualLiquifyAmount > minLiquifyAmount ? minLiquifyAmount : percentualLiquifyAmount
          const halfLiquifyAmount = liquifyAmount / 2
          const feeAmount = value * 0.05
          const txAmount = value - feeAmount
          const overlapAmount = feeAmount - liquifyAmount

          it(`should liquify percentual based on volume (percentage = ${percentage}, amount = ${value})`, async function () {
            // Arrange
            await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: feeReceiver.address, doLiquify: true, swapOrLiquifyAmount: parseEther(minLiquifyAmount) })) // 5%
            await contract.setPercentageVolumeLiquify(percentage) // % of volume
            await contract.setPancakePairBnbAddress(mockPancakePairBnb.address)

            // Assigning WSI to Pancakepair as volume,
            // so we'd swap a maximum of two percent of the volume.
            // Example: 150 WSI * 2% = 3 WSI
            await mockWsi.transfer(mockPancakePairBnb.address, parseEther(amount))
            await setBalance(mockPancakeRouter.address, parseEther(halfLiquifyAmount))

            // Act
            await mockWsi.transfer(alice.address, parseEther(amount))
            await mockWsi.connect(alice).transfer(bob.address, parseEther(amount))

            // Assert
            expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.not.been.called
            expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.been.calledOnce
            expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledWith(
              parseEther(halfLiquifyAmount), // see percentual amount
              0,
              [mockWsi.address, mockBnb.address],
              contract.address,
              await getBlockTimestamp()
            )

            expect(mockPancakeRouter.addLiquidityETH).to.have.been.calledOnce
            expect(mockPancakeRouter.addLiquidityETH).to.be.calledWith(
              mockWsi.address,
              parseEther(halfLiquifyAmount),
              0,
              0,
              feeReceiver.address,
              await getBlockTimestamp()
            )
            expect(mockPancakeRouter.addLiquidityETH.getCall(0).value).to.equal(parseEther(halfLiquifyAmount))

            expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('0'))
            expect(await mockWsi.balanceOf(bob.address)).to.equal(parseEther(txAmount))
            expect(await mockWsi.balanceOf(contract.address)).to.be.closeTo(parseEther(overlapAmount), 1000)
            expect(await mockWsi.balanceOf(feeReceiver.address)).to.equal(parseEther('0'))
          })
        }
      }

      it('should liquify without reentryancy if threshold was reached two times in one transaction', async function () {
        // Arrange
        await mockWsi.transfer(mockPancakePairBnb.address, parseEther('1000'))
        await setBalance(mockPancakeRouter.address, parseEther('10'))
        await contract.addFee(...getFeeEntryArgs({ from: mockPancakePairBnb.address, percentage: 5000, destination: feeReceiver.address, doLiquify: true, swapOrLiquifyAmount: parseEther('5') })) // 5%
        await contract.setPancakePairBnbAddress(mockPancakePairBnb.address)

        // Act
        await mockBnb.transfer(alice.address, parseEther('1000'))
        await mockBnb.connect(alice).approve(mockPancakeRouter.address, parseEther('1000'))
        await mockPancakeRouter.connect(alice).swapExactETHForTokensSupportingFeeOnTransferTokens(
          parseEther('1000'),
          [mockBnb.address, mockWsi.address],
          alice.address,
          moment().add('60', 'seconds').unix()
        )

        // Assert
        expect(mockPancakePairBnb.swap).to.have.been.calledOnce
      })

      it('should not add liquidity percentual based on volume if swap percentage volume is zero', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: addrs[0].address, doLiquify: true, swapOrLiquifyAmount: parseEther('5') })) // 5%
        await contract.setPercentageVolumeLiquify(0)
        await contract.setPancakePairBnbAddress(mockPancakePairBnb.address)

        // Assigning 100 WSI to Pancakepair as volume.
        // So we'd swap a maximum of ten percent of the volume, which equals 10 WSI
        await mockWsi.transfer(mockPancakePairBnb.address, parseEther('100'))
        await mockWsi.transfer(alice.address, parseEther('100'))
        await setBalance(mockPancakeRouter.address, parseEther('2.5'))

        // Act
        await mockWsi.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.not.been.called

        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.been.calledOnce
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('2.5'),
          0,
          [mockWsi.address, mockBnb.address],
          contract.address,
          await getBlockTimestamp()
        )

        expect(mockPancakeRouter.addLiquidityETH).to.have.been.calledOnce
        expect(mockPancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('2.5'),
          0,
          0,
          addrs[0].address,
          await getBlockTimestamp()
        )

        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(bob.address)).to.equal(parseEther('95'))
        expect(await mockWsi.balanceOf(mockPancakePairBnb.address)).to.equal(parseEther('105')) // 100 from arrange
      })

      it('should not add liquidity percentual based on volume if PancakeSwap pair address is zero', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: addrs[0].address, doLiquify: true, swapOrLiquifyAmount: parseEther('5') })) // 5%
        await contract.setPercentageVolumeLiquify(2) // 2% of volume
        expect(await contract.pancakePairBnbAddress()).to.equal(ethers.constants.AddressZero)

        // Assigning 100 WSI to Pancakepair as volume.
        // So we'd swap a maximum of rwo percent of the volume, which equals 2 WSI
        await mockWsi.transfer(mockPancakePairBnb.address, parseEther('100'))
        await mockWsi.transfer(alice.address, parseEther('100'))
        await setBalance(mockPancakeRouter.address, parseEther('2.5'))

        // Act
        await mockWsi.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.not.been.called

        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.been.calledOnce
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('2.5'),
          0,
          [mockWsi.address, mockBnb.address],
          contract.address,
          await getBlockTimestamp()
        )

        expect(mockPancakeRouter.addLiquidityETH).to.have.been.calledOnce
        expect(mockPancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('2.5'),
          0,
          0,
          addrs[0].address,
          await getBlockTimestamp()
        )

        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(bob.address)).to.equal(parseEther('95'))
        expect(await mockWsi.balanceOf(mockPancakePairBnb.address)).to.equal(parseEther('105')) // 100 from arrange
      })

      it('should fail to add liquidity percentual based on volume if token approve for swap fails', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: addrs[0].address, doLiquify: true, swapOrLiquifyAmount: parseEther('5') })) // 5%
        await contract.setPercentageVolumeSwap(2) // 2% of volume
        await contract.setPancakePairBnbAddress(mockPancakePairBnb.address)

        // Assigning 100 WSI to Pancakepair as volume.
        // So we'd swap a maximum of two percent of the volume, which equals 2 WSI
        await mockWsi.transfer(mockPancakePairBnb.address, parseEther('100'))
        await mockWsi.transfer(alice.address, parseEther('100'))
        mockWsi.approve.returns(false)

        // Act
        await expect(
          mockWsi.connect(alice).transfer(bob.address, parseEther('100'))
        ).to.be.revertedWith('DynamicFeeManager: Failed to approve token for swap to BNB')
      })

      it('should fail to add liquidity percentual based on volume if token approve for adding liquidity fails', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: addrs[0].address, doLiquify: true, swapOrLiquifyAmount: parseEther('5') })) // 5%
        await contract.setPercentageVolumeSwap(2) // 2% of volume
        await contract.setPancakePairBnbAddress(mockPancakePairBnb.address)

        // Assigning 100 WSI to Pancakepair as volume.
        // So we'd swap a maximum of two percent of the volume, which equals 2 WSI
        await mockWsi.transfer(mockPancakePairBnb.address, parseEther('100'))
        await mockWsi.transfer(alice.address, parseEther('100'))
        await setBalance(mockPancakeRouter.address, parseEther('2.5'))
        mockWsi.approve.returnsAtCall(1, false)

        // Act
        await expect(
          mockWsi.connect(alice).transfer(bob.address, parseEther('100'))
        ).to.be.revertedWith('DynamicFeeManager: Failed to approve token for adding liquidity')
      })

      it('should fail to add liquidity percentual based on volume if token transfer fails', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: addrs[0].address, doLiquify: true, swapOrLiquifyAmount: parseEther('5') })) // 5%
        await contract.setPercentageVolumeSwap(2) // 2% of volume
        await contract.setPancakePairBnbAddress(mockPancakePairBnb.address)
        mockWsi.transferFromNoFees.returns(false)

        // Assigning 100 WSI to Pancakepair as volume.
        // So we'd swap a maximum of two percent of the volume, which equals 2 WSI
        await mockWsi.transfer(mockPancakePairBnb.address, parseEther('100'))

        // Act
        await expect(
          mockWsi.connect(alice).transfer(bob.address, parseEther('100'))
        ).to.be.revertedWith('DynamicFeeManager: Fee transfer to manager failed')
      })
    })

    describe('Swap to BUSD', function () {
      it('should swap after threshold is reached', async function () {
        // Arrange
        await mockWsi.transfer(mockPancakePairBusd.address, parseEther('500'))
        await contract.addFee(...getFeeEntryArgs({ from: mockPancakePairBusd.address, percentage: 5000, destination: feeReceiver.address, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('25') })) // 5%
        await contract.addFee(...getFeeEntryArgs({ percentage: 3000, destination: feeReceiver.address })) // 3%

        for (let i = 0; i < 3; i++) {
          // Act
          await mockBusd.transfer(alice.address, parseEther('100'))
          await mockBusd.connect(alice).approve(mockPancakeRouter.address, parseEther('100'))
          await mockPancakeRouter.connect(alice).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            parseEther('100'),
            parseEther('100'),
            [mockBusd.address, mockWsi.address],
            alice.address,
            moment().add('60', 'seconds').unix()
          )
        }

        for (let i = 0; i < 1; i++) {
          // Act
          await mockBusd.transfer(bob.address, parseEther('100'))
          await mockBusd.connect(bob).approve(mockPancakeRouter.address, parseEther('100'))
          await mockPancakeRouter.connect(bob).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            parseEther('100'),
            parseEther('100'),
            [mockBusd.address, mockWsi.address],
            bob.address,
            moment().add('60', 'seconds').unix()
          )
        }

        // Assert
        expect(await mockBusd.balanceOf(mockPancakePairBusd.address)).to.equal(parseEther('400'))
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('20'))
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('285'))
        expect(await mockWsi.balanceOf(bob.address)).to.equal(parseEther('95'))
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.not.been.called
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.callCount(4)

        // Act
        await mockWsi.transfer(alice.address, parseEther('100'))
        await mockWsi.connect(alice).transfer(charlie.address, parseEther('100'))

        // Assert
        expect(await mockWsi.balanceOf(charlie.address)).to.equal(parseEther('97'))
        expect(await mockWsi.balanceOf(feeReceiver.address)).to.equal(parseEther('3'))
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.not.been.called
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.callCount(4)

        // Act
        await mockBusd.transfer(bob.address, parseEther('100'))
        await mockBusd.connect(bob).approve(mockPancakeRouter.address, parseEther('100'))
        await mockPancakeRouter.connect(bob).swapExactTokensForTokensSupportingFeeOnTransferTokens(
          parseEther('100'),
          parseEther('100'),
          [mockBusd.address, mockWsi.address],
          bob.address,
          moment().add('60', 'seconds').unix()
        )

        // Assert
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.not.been.called
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.callCount(6)
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('25'),
          0,
          [mockWsi.address, mockBusd.address],
          feeReceiver.address,
          await getBlockTimestamp()
        )

        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('285'))
        expect(await mockWsi.balanceOf(bob.address)).to.equal(parseEther('190'))
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(mockPancakePairBusd.address)).to.equal(parseEther('25'))
        expect(await mockBusd.balanceOf(feeReceiver.address)).to.equal(parseEther('25'))
      })

      for (const percentage of [0, 1, 2, 5, 10, 20, 50, 75, 100]) {
        for (const value of [100, 137, 150, 200, 300, 500, 1000, 1330, 1000000, 2000000, 5000000, 17011995]) {
          const minSwapAmount = 5
          const amount = value
          const percentualSwapAmount = percentage > 0 ? value * (percentage / 100) : value
          const swapAmount = percentualSwapAmount > minSwapAmount ? minSwapAmount : percentualSwapAmount
          const feeAmount = value * 0.05
          const txAmount = value - feeAmount
          const overlapAmount = feeAmount - swapAmount

          it(`should swap percentual based on volume (percentage = ${percentage}, amount = ${value})`, async function () {
            // Arrange
            await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: feeReceiver.address, doSwapForBusd: true, swapOrLiquifyAmount: parseEther(minSwapAmount) })) // 5%
            await contract.setPercentageVolumeSwap(percentage) // % of volume
            await contract.setPancakePairBusdAddress(mockPancakePairBusd.address)

            // Assigning WSI to Pancakepair as volume,
            // so we'd swap a maximum of two percent of the volume.
            // Example: 150 WSI * 2% = 3 WSI
            await mockWsi.transfer(mockPancakePairBusd.address, parseEther(amount))
            await mockBusd.transfer(mockPancakePairBusd.address, parseEther(swapAmount))

            // Act
            await mockWsi.transfer(alice.address, parseEther(amount))
            await mockWsi.connect(alice).transfer(bob.address, parseEther(amount))

            // Assert
            expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.not.been.called
            expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.been.calledOnce
            expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
              parseEther(swapAmount), // see percentual amount
              0,
              [mockWsi.address, mockBusd.address],
              feeReceiver.address,
              await getBlockTimestamp()
            )

            expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('0'))
            expect(await mockWsi.balanceOf(bob.address)).to.equal(parseEther(txAmount))
            expect(await mockWsi.balanceOf(contract.address)).to.be.closeTo(parseEther(overlapAmount), 1000)
            expect(await mockWsi.balanceOf(feeReceiver.address)).to.equal(parseEther('0'))
            expect(await mockBusd.balanceOf(feeReceiver.address)).to.equal(parseEther(swapAmount))
          })
        }
      }

      it('should not swap percentual based on volume if swap percentage volume is zero', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: feeReceiver.address, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('5') })) // 5%
        await contract.setPercentageVolumeSwap(0)
        await contract.setPancakePairBusdAddress(mockPancakePairBusd.address)

        // Assigning WSI to Pancakepair as volume,
        // so we'd swap a maximum of two percent of the volume.
        // Example: 150 WSI * 2% = 3 WSI
        await mockWsi.transfer(mockPancakePairBusd.address, parseEther('150'))
        await mockBusd.transfer(mockPancakePairBusd.address, parseEther('150'))

        // Act
        await mockWsi.transfer(alice.address, parseEther('150'))
        await mockWsi.connect(alice).transfer(bob.address, parseEther('150'))

        // Assert
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.not.been.called
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.been.calledOnce
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('5'), // see percentual amount
          0,
          [mockWsi.address, mockBusd.address],
          feeReceiver.address,
          await getBlockTimestamp()
        )

        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(bob.address)).to.equal(parseEther('142.5'))
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('2.5'))
        expect(await mockWsi.balanceOf(feeReceiver.address)).to.equal(parseEther('0'))
        expect(await mockBusd.balanceOf(feeReceiver.address)).to.equal(parseEther('5'))
      })

      it('should not swap percentual based on volume if PancakeSwap pair address is zero', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: feeReceiver.address, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('5') })) // 5%
        await contract.setPercentageVolumeSwap(2)
        expect(await contract.pancakePairBusdAddress()).to.equal(ethers.constants.AddressZero)

        // Assigning WSI to Pancakepair as volume,
        // so we'd swap a maximum of two percent of the volume.
        // Example: 150 WSI * 2% = 3 WSI
        await mockWsi.transfer(mockPancakePairBusd.address, parseEther('150'))
        await mockBusd.transfer(mockPancakePairBusd.address, parseEther('150'))

        // Act
        await mockWsi.transfer(alice.address, parseEther('150'))
        await mockWsi.connect(alice).transfer(bob.address, parseEther('150'))

        // Assert
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.have.not.been.called
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.have.been.calledOnce
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('5'), // see percentual amount
          0,
          [mockWsi.address, mockBusd.address],
          feeReceiver.address,
          await getBlockTimestamp()
        )

        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(bob.address)).to.equal(parseEther('142.5'))
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('2.5'))
        expect(await mockWsi.balanceOf(feeReceiver.address)).to.equal(parseEther('0'))
        expect(await mockBusd.balanceOf(feeReceiver.address)).to.equal(parseEther('5'))
      })

      it('should fail to swap percentual based on volume if token approve fails', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: addrs[0].address, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('5') })) // 5%
        await contract.setPercentageVolumeSwap(2) // 2% of volume
        await contract.setPancakePairBusdAddress(mockPancakePairBusd.address)
        mockWsi.approve.returns(false)

        // Assigning 100 WSI to Pancakepair as volume.
        // So we'd swap a maximum of two percent of the volume, which equals 2 WSI
        await mockWsi.transfer(mockPancakePairBusd.address, parseEther('100'))

        // Act
        await mockWsi.transfer(alice.address, parseEther('100'))
        await expect(
          mockWsi.connect(alice).transfer(bob.address, parseEther('100'))
        ).to.be.revertedWith('DynamicFeeManager: Failed to approve token for swap to BUSD')
      })

      it('should fail to swap percentual based on volume if token transfer fails', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ percentage: 5000, destination: addrs[0].address, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('5') })) // 5%
        await contract.setPercentageVolumeSwap(2) // 2% of volume
        await contract.setPancakePairBusdAddress(mockPancakePairBusd.address)
        mockWsi.transferFromNoFees.returns(false)

        // Assigning 100 WSI to Pancakepair as volume.
        // So we'd swap a maximum of two percent of the volume, which equals 2 WSI
        await mockWsi.transfer(mockPancakePairBusd.address, parseEther('100'))

        // Act
        await expect(
          mockWsi.connect(alice).transfer(bob.address, parseEther('100'))
        ).to.be.revertedWith('DynamicFeeManager: Fee transfer to manager failed')
      })
    })
  })

})