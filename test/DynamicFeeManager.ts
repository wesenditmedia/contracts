import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import chai from 'chai'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { DynamicFeeManager, MockERC20, MockFeeReceiver__factory, MockPancakeRouter, MockPancakeRouter__factory } from "../typechain";
import { MockContract, smock } from '@defi-wonderland/smock';
import { MockFeeReceiver } from "../typechain/MockFeeReceiver";
import { BigNumberish } from "ethers";
import { parseEther } from "ethers/lib/utils";

chai.should();
chai.use(smock.matchers);

const WHITELIST_ADDRESS = '0x000000000000000000000000000000000000dEaD'

export const getFeeEntryArgs = (args?: {
  from?: string,
  to?: string,
  percentage?: BigNumberish,
  destination?: string,
  doCallback?: boolean,
  doLiquify?: boolean,
  doSwapForBusd?: boolean,
  swapOrLiquifyAmount?: BigNumberish
}): Parameters<typeof DynamicFeeManager.prototype.addFee> => {
  return [
    args?.from ?? WHITELIST_ADDRESS,
    args?.to ?? WHITELIST_ADDRESS,
    args?.percentage ?? 0,
    args?.destination ?? ethers.constants.AddressZero,
    args?.doCallback ?? false,
    args?.doLiquify ?? false,
    args?.doSwapForBusd ?? false,
    args?.swapOrLiquifyAmount ?? 0
  ]
}

const getBlockTimestamp = async () => {
  const blockNum = await ethers.provider.getBlockNumber()
  const block = await ethers.provider.getBlock(blockNum)

  return block.timestamp
}

describe("Dynamic Fee Manager", function () {
  let contract: DynamicFeeManager

  let mockBnb: MockERC20
  let mockWsi: MockERC20
  let mockBusd: MockERC20
  let mockPancakeRouter: MockContract<MockPancakeRouter>;
  let mockFeeReceiver: MockContract<MockFeeReceiver>

  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;
  let addrs: SignerWithAddress[];

  let ADMIN_ROLE: string

  beforeEach(async function () {
    [owner, alice, bob, charlie, ...addrs] = await ethers.getSigners();

    const DynamicFeeManager = await ethers.getContractFactory("DynamicFeeManager")
    contract = await DynamicFeeManager.deploy()

    const MockERC20 = await ethers.getContractFactory('MockERC20')
    mockBnb = await MockERC20.deploy()
    mockWsi = await MockERC20.deploy()
    mockBusd = await MockERC20.deploy()

    const MockPancakeRouter = await smock.mock<MockPancakeRouter__factory>('MockPancakeRouter')
    mockPancakeRouter = await MockPancakeRouter.deploy(mockBnb.address)

    const MockFeeReceiver = await smock.mock<MockFeeReceiver__factory>('MockFeeReceiver')
    mockFeeReceiver = await MockFeeReceiver.deploy()

    ADMIN_ROLE = await contract.ADMIN()

    await contract.setPancakeRouter(mockPancakeRouter.address)
    await contract.setBusdAddress(mockBusd.address)
  });

  describe("Deployment", function () {
    it("should set the right owner", async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("should assign correct initial values", async function () {
      expect(await contract.pancakeRouter()).to.equal(mockPancakeRouter.address);
      expect(await contract.busdAddress()).to.equal(mockBusd.address);
    })

    it("should assign correct roles to creator", async function () {
      expect(await contract.hasRole(ADMIN_ROLE, owner.address)).to.equal(true)
      expect(await contract.getRoleAdmin(ADMIN_ROLE)).to.equal(ADMIN_ROLE)
    })
  });

  describe('Dynamic Fee Management', function () {
    describe('Add Fee', function () {
      it('should add single fee', async function () {
        // Arrange & Assert
        const res = await contract.addFee(...getFeeEntryArgs())

        expect(res.value).to.equal(0)
      })

      it('should add fee if percentage is equal 100%', async function () {
        // Arrange & Assert
        const res = await contract.addFee(...getFeeEntryArgs({
          percentage: 100000
        }))

        expect(res.value).to.equal(0)
      })

      it('should fail to add fee if percentage is over 100%', async function () {
        // Arrange & Assert
        await expect(contract.addFee(...getFeeEntryArgs({
          percentage: 100001
        }))).to.be.revertedWith('DynamicFeeManager: Invalid fee percentage')
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

      it('should fail to add fee as non-owner', async function () {
        // Arrange & Assert
        await expect(
          contract.connect(alice).addFee(...getFeeEntryArgs())
        ).to.be.reverted
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
            doCallback: true,
            doLiquify: true,
            doSwapForBusd: false,
            swapOrLiquifyAmount: 5678
          })
        )

        // Assert
        const fee = await contract.getFee(0)
        expect(fee.id).to.be.string
        expect(fee.from).to.equal(alice.address)
        expect(fee.to).to.equal(bob.address)
        expect(fee.percentage).to.equal(1234)
        expect(fee.destination).to.equal(addrs[0].address)
        expect(fee.doCallback).to.be.true
        expect(fee.doLiquify).to.be.true
        expect(fee.doSwapForBusd).to.be.false
        expect(fee.swapOrLiquifyAmount).to.equal(5678)
      })

      it('should get fee at index (2)', async function () {
        // Arrange
        await contract.addFee(
          ...getFeeEntryArgs({
            from: alice.address,
            to: bob.address,
            percentage: 1234,
            destination: addrs[0].address,
            doCallback: true,
            doLiquify: false,
            doSwapForBusd: true,
            swapOrLiquifyAmount: 5678
          })
        )

        // Assert
        const fee = await contract.getFee(0)
        expect(fee.id).to.be.string
        expect(fee.from).to.equal(alice.address)
        expect(fee.to).to.equal(bob.address)
        expect(fee.percentage).to.equal(1234)
        expect(fee.destination).to.equal(addrs[0].address)
        expect(fee.doCallback).to.be.true
        expect(fee.doLiquify).to.be.false
        expect(fee.doSwapForBusd).to.be.true
        expect(fee.swapOrLiquifyAmount).to.equal(5678)
      })
    })

    describe('Remove Fee', function () {
      it('should remove fee at index as owner', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs())

        // Assert
        await contract.removeFee(0)
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
    })
  })

  describe('Fee Calculation', function () {
    it('should calculate correct fee for single entry', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ percentage: 10000 })) // 10%

      // Act
      const res = await contract.calculateFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(res[0]).to.equal(parseEther('90'))
      expect(res[1]).to.equal(parseEther('10'))
    })

    it('should calculate correct fee for multiple entries', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ percentage: 10000 })) // 10%
      await contract.addFee(...getFeeEntryArgs({ percentage: 5000 })) // 5%

      // Act
      const res = await contract.calculateFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(res[0]).to.equal(parseEther('85'))
      expect(res[1]).to.equal(parseEther('15'))
    })

    it('should calculate correct fee for relevant entries (1)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ percentage: 10000 })) // 10%
      await contract.addFee(...getFeeEntryArgs({ to: bob.address, percentage: 5000 })) // 5%

      // Act
      const res = await contract.calculateFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(res[0]).to.equal(parseEther('85'))
      expect(res[1]).to.equal(parseEther('15'))
    })

    it('should calculate correct fee for relevant entries (2)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ percentage: 10000 })) // 10%
      await contract.addFee(...getFeeEntryArgs({ from: bob.address, percentage: 5000 })) // 5%

      // Act
      const res = await contract.calculateFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(res[0]).to.equal(parseEther('90'))
      expect(res[1]).to.equal(parseEther('10'))
    })

    it('should calculate correct fee for relevant entries (3)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ percentage: 5000 })) // 5%
      await contract.addFee(...getFeeEntryArgs({ from: bob.address, percentage: 5000 })) // 10%

      // Act
      const res = await contract.calculateFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(res[0]).to.equal(parseEther('95'))
      expect(res[1]).to.equal(parseEther('5'))
    })

    it('should calculate correct fee for relevant entries (4)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ percentage: 10000 })) // 10%
      await contract.addFee(...getFeeEntryArgs({ from: bob.address, percentage: 5000 })) // 5%
      await contract.addFee(...getFeeEntryArgs({ from: alice.address, percentage: 7500 })) // 7.5%
      await contract.addFee(...getFeeEntryArgs({ to: bob.address, percentage: 2500 })) // 2.5%

      // Act
      const res = await contract.calculateFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(res[0]).to.equal(parseEther('80'))
      expect(res[1]).to.equal(parseEther('20'))
    })

    it('should calculate correct fee for relevant entries (5)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ percentage: 10000 })) // 10%
      await contract.addFee(...getFeeEntryArgs({ from: alice.address, percentage: 5000 })) // 5%
      await contract.addFee(...getFeeEntryArgs({ from: alice.address, percentage: 7500 })) // 7.5%
      await contract.addFee(...getFeeEntryArgs({ to: bob.address, percentage: 2500 })) // 2.5%

      // Act
      const res = await contract.calculateFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(res[0]).to.equal(parseEther('75'))
      expect(res[1]).to.equal(parseEther('25'))
    })

    it('should calculate correct fee for relevant entries (6)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ percentage: 10000 })) // 10%
      await contract.addFee(...getFeeEntryArgs({ from: alice.address, percentage: 5000 })) // 5%
      await contract.addFee(...getFeeEntryArgs({ from: alice.address, percentage: 7500 })) // 7.5%
      await contract.addFee(...getFeeEntryArgs({ to: bob.address, percentage: 2500 })) // 2.5%
      await contract.addFee(...getFeeEntryArgs({ percentage: 10000 })) // 10%
      await contract.addFee(...getFeeEntryArgs({ to: bob.address, percentage: 10000 })) // 10%
      await contract.addFee(...getFeeEntryArgs({ to: bob.address, percentage: 10000 })) // 10%

      // Act
      const res = await contract.calculateFees(
        alice.address,
        bob.address,
        parseEther('100')
      )

      // Assert
      expect(res[0]).to.equal(parseEther('45'))
      expect(res[1]).to.equal(parseEther('55'))
    })

    it('should calculate correct fee for relevant entries (7)', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ percentage: 10000 })) // 10%
      await contract.addFee(...getFeeEntryArgs({ from: alice.address, percentage: 5000 })) // 5%
      await contract.addFee(...getFeeEntryArgs({ from: alice.address, percentage: 7500 })) // 7.5%
      await contract.addFee(...getFeeEntryArgs({ to: bob.address, percentage: 2500 })) // 2.5%

      // Act
      const res = await contract.calculateFees(
        alice.address,
        bob.address,
        parseEther('0.0002')
      )

      // Assert
      expect(res[0]).to.equal(parseEther('0.000150'))
      expect(res[1]).to.equal(parseEther('0.000050'))
    })

    it('should fail to calculate fee is overall fee is equal 100%', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ percentage: 100000 })) // 100%

      // Act & Assert
      await expect(contract.calculateFees(
        alice.address,
        bob.address,
        parseEther('100')
      )).to.be.revertedWith('DynamicFeeManager: invalid total amount')
    })

    it('should fail to calculate fee is overall fee is over 100%', async function () {
      // Arrange
      await contract.addFee(...getFeeEntryArgs({ percentage: 100000 })) // 100%
      await contract.addFee(...getFeeEntryArgs({ percentage: 1000 })) // 1%

      // Act & Assert
      await expect(contract.calculateFees(
        alice.address,
        bob.address,
        parseEther('100')
      )).to.be.reverted
    })
  })

  describe('Fee Refelection', function () {
    beforeEach(async function () {
      await mockWsi.transfer(alice.address, parseEther('100'))
    })

    describe('Basic Fees', function () {
      it('should reflect single fee', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('10'))
      })

      it('should reflect multiple fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10%
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 2500 })) // 2.5%
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 5000 })) // 5%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('17.5'))
      })

      it('should reflect relevant fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 10000 })) // 10% (matches)
        await contract.addFee(...getFeeEntryArgs({ from: bob.address, destination: addrs[0].address, percentage: 1500 })) // 1.5%
        await contract.addFee(...getFeeEntryArgs({ to: bob.address, destination: addrs[0].address, percentage: 2500 })) // 2.5% (matches)
        await contract.addFee(...getFeeEntryArgs({ from: alice.address, destination: addrs[0].address, percentage: 3500 })) // 3.5% (matches)
        await contract.addFee(...getFeeEntryArgs({ to: alice.address, destination: addrs[0].address, percentage: 4500 })) // 4.5%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(await mockWsi.balanceOf(alice.address)).to.equal(parseEther('0'))
        expect(await mockWsi.balanceOf(addrs[0].address)).to.equal(parseEther('16'))
      })

      it('should fail to reflect fee is overall fee is equal 100%', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 100000 })) // 100%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act & Assert
        await expect(contract.reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )).to.be.revertedWith('DynamicFeeManager: invalid total amount')
      })

      it('should fail to reflect fee is overall fee is over 100%', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 100000 })) // 100%
        await contract.addFee(...getFeeEntryArgs({ destination: addrs[0].address, percentage: 1000 })) // 1%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act & Assert
        await expect(contract.reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )).to.be.reverted
      })
    })

    describe('Fees with callback', function () {
      it('should reflect single fee and call callback', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doCallback: true })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
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
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doCallback: true })) // 10%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 2500, doCallback: true })) // 2.5%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 5000, doCallback: true })) // 5%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(mockFeeReceiver.onERC20Received).to.have.been.calledThrice

        expect(mockFeeReceiver.onERC20Received).to.have.been.calledWith(
          contract.address,
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('10')
        )

        expect(mockFeeReceiver.onERC20Received).to.have.been.calledWith(
          contract.address,
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('2.5')
        )

        expect(mockFeeReceiver.onERC20Received).to.have.been.calledWith(
          contract.address,
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('5')
        )
      })

      it('should reflect relevant fees and call callbacks', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doCallback: true })) // 10% (matches)
        await contract.addFee(...getFeeEntryArgs({ from: bob.address, destination: mockFeeReceiver.address, percentage: 1500, doCallback: true })) // 1.5%
        await contract.addFee(...getFeeEntryArgs({ to: bob.address, destination: mockFeeReceiver.address, percentage: 2500, doCallback: true })) // 2.5% (matches)
        await contract.addFee(...getFeeEntryArgs({ from: alice.address, destination: mockFeeReceiver.address, percentage: 3500, doCallback: false })) // 3.5% (matches, no callback)
        await contract.addFee(...getFeeEntryArgs({ to: alice.address, destination: mockFeeReceiver.address, percentage: 4500, doCallback: true })) // 4.5%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(mockFeeReceiver.onERC20Received).to.have.been.calledTwice

        expect(mockFeeReceiver.onERC20Received).to.have.been.calledWith(
          contract.address,
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('10')
        )

        expect(mockFeeReceiver.onERC20Received).to.have.been.calledWith(
          contract.address,
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('2.5')
        )
      })
    })

    describe('Fees with liquify', function () {
      it('should collect liquidation amount for single fee', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('11') })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('100'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('10'))
      })

      it('should collect liquidation amount for multiple same fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('21') })) // 10%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('21') })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('100'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('20'))
      })

      it('should collect liquidation amount for multiple different fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('11') })) // 10%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('21') })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('100'))

        const feeOne = await contract.getFee(0)
        expect(await contract.getFeeAmount(feeOne.id)).to.equal(parseEther('10'))

        const feeTwo = await contract.getFee(1)
        expect(await contract.getFeeAmount(feeTwo.id)).to.equal(parseEther('10'))
      })

      it('should collect liquidation amount for multiple transactions with single fee', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('8') })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('50'),
          false
        )

        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('25'),
          false
        )

        // Assert
        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('100'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('7.5'))
      })

      it('should add liquidy if amount is reached for single fee', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('10') })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(await mockWsi.balanceOf(mockPancakeRouter.address)).to.equal(parseEther('10'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('0'))

        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledOnce

        expect(mockPancakeRouter.addLiquidityETH).to.be.calledOnce
        // expect(mockPancakeRouter.addLiquidityETH).to.be.calledWithValue(parseEther('5'))
        expect(mockPancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('5'),
          0,
          0,
          mockFeeReceiver.address,
          await getBlockTimestamp()
        )
      })

      it('should add liquidy if amount is reached for multiple same fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('12') })) // 10%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('12') })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(await mockWsi.balanceOf(mockPancakeRouter.address)).to.equal(parseEther('12'))

        const feeOne = await contract.getFee(0)
        expect(await contract.getFeeAmount(feeOne.id)).to.equal(parseEther('8'))

        const feeTwo = await contract.getFee(1)
        expect(await contract.getFeeAmount(feeTwo.id)).to.equal(parseEther('8'))

        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledOnce

        expect(mockPancakeRouter.addLiquidityETH).to.be.calledOnce
        // expect(mockPancakeRouter.addLiquidityETH).to.be.calledWithValue(parseEther('5'))
        expect(mockPancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('6'),
          0,
          0,
          mockFeeReceiver.address,
          await getBlockTimestamp()
        )
      })

      it('should add liquidy if amount is reached for multiple different fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('10') })) // 10%
        await contract.addFee(...getFeeEntryArgs({ destination: charlie.address, percentage: 20000, doLiquify: true, swapOrLiquifyAmount: parseEther('20') })) // 20%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(await mockWsi.balanceOf(mockPancakeRouter.address)).to.equal(parseEther('30'))

        const feeOne = await contract.getFee(0)
        expect(await contract.getFeeAmount(feeOne.id)).to.equal(parseEther('0'))

        const feeTwo = await contract.getFee(1)
        expect(await contract.getFeeAmount(feeTwo.id)).to.equal(parseEther('0'))

        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledTwice

        expect(mockPancakeRouter.addLiquidityETH).to.be.calledTwice
        // expect(mockPancakeRouter.addLiquidityETH).to.be.calledWithValue(parseEther('5'))
        expect(mockPancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('5'),
          0,
          0,
          bob.address,
          await getBlockTimestamp()
        )

        expect(mockPancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('10'),
          0,
          0,
          charlie.address,
          await getBlockTimestamp()
        )
      })

      it('should add liquidy if amount is reached for one of multiple different fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('10') })) // 10%
        await contract.addFee(...getFeeEntryArgs({ destination: charlie.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('20') })) // 20%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(await mockWsi.balanceOf(mockPancakeRouter.address)).to.equal(parseEther('10'))

        const feeOne = await contract.getFee(0)
        expect(await contract.getFeeAmount(feeOne.id)).to.equal(parseEther('0'))

        const feeTwo = await contract.getFee(1)
        expect(await contract.getFeeAmount(feeTwo.id)).to.equal(parseEther('10'))

        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.be.calledOnce

        expect(mockPancakeRouter.addLiquidityETH).to.be.calledOnce
        // expect(mockPancakeRouter.addLiquidityETH).to.be.calledWithValue(parseEther('5'))
        expect(mockPancakeRouter.addLiquidityETH).to.be.calledWith(
          mockWsi.address,
          parseEther('5'),
          0,
          0,
          bob.address,
          await getBlockTimestamp()
        )
      })

      it('should not add liquidy if bypass is set to true', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 10000, doLiquify: true, swapOrLiquifyAmount: parseEther('10') })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          true
        )

        // Assert
        expect(await mockWsi.balanceOf(mockPancakeRouter.address)).to.equal(parseEther('0'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('10'))

        expect(mockPancakeRouter.swapExactTokensForETHSupportingFeeOnTransferTokens).to.not.be.called
        expect(mockPancakeRouter.addLiquidityETH).to.not.be.called
      })
    })

    describe('Fees with swap', function () {
      it('should collect swap amount for single fee', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('11') })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('100'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('10'))
      })

      it('should collect swap amount for multiple same fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('21') })) // 10%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('21') })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('100'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('20'))
      })

      it('should collect swap amount for multiple different fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('11') })) // 10%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('21') })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.not.be.called
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('100'))

        const feeOne = await contract.getFee(0)
        expect(await contract.getFeeAmount(feeOne.id)).to.equal(parseEther('10'))

        const feeTwo = await contract.getFee(1)
        expect(await contract.getFeeAmount(feeTwo.id)).to.equal(parseEther('10'))
      })

      it('should swap if amount is reached for single fee', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('10') })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(await mockWsi.balanceOf(mockPancakeRouter.address)).to.equal(parseEther('10'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('0'))

        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledOnce
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('10'),
          0,
          [mockWsi.address, mockBusd.address],
          mockFeeReceiver.address,
          await getBlockTimestamp()
        )
      })

      it('should swap if amount is reached for multiple same fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('12') })) // 10%
        await contract.addFee(...getFeeEntryArgs({ destination: mockFeeReceiver.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('12') })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(await mockWsi.balanceOf(mockPancakeRouter.address)).to.equal(parseEther('12'))

        const feeOne = await contract.getFee(0)
        expect(await contract.getFeeAmount(feeOne.id)).to.equal(parseEther('8'))

        const feeTwo = await contract.getFee(1)
        expect(await contract.getFeeAmount(feeTwo.id)).to.equal(parseEther('8'))

        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledOnce
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('12'),
          0,
          [mockWsi.address, mockBusd.address],
          mockFeeReceiver.address,
          await getBlockTimestamp()
        )
      })

      it('should swap if amount is reached for multiple different fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('10') })) // 10%
        await contract.addFee(...getFeeEntryArgs({ destination: charlie.address, percentage: 20000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('20') })) // 20%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(await mockWsi.balanceOf(mockPancakeRouter.address)).to.equal(parseEther('30'))

        const feeOne = await contract.getFee(0)
        expect(await contract.getFeeAmount(feeOne.id)).to.equal(parseEther('0'))

        const feeTwo = await contract.getFee(1)
        expect(await contract.getFeeAmount(feeTwo.id)).to.equal(parseEther('0'))

        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledTwice
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('10'),
          0,
          [mockWsi.address, mockBusd.address],
          bob.address,
          await getBlockTimestamp()
        )

        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('20'),
          0,
          [mockWsi.address, mockBusd.address],
          charlie.address,
          await getBlockTimestamp()
        )
      })

      it('should swap if amount is reached for one of multiple different fees', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('10') })) // 10%
        await contract.addFee(...getFeeEntryArgs({ destination: charlie.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('20') })) // 20%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          false
        )

        // Assert
        expect(await mockWsi.balanceOf(mockPancakeRouter.address)).to.equal(parseEther('10'))

        const feeOne = await contract.getFee(0)
        expect(await contract.getFeeAmount(feeOne.id)).to.equal(parseEther('0'))

        const feeTwo = await contract.getFee(1)
        expect(await contract.getFeeAmount(feeTwo.id)).to.equal(parseEther('10'))

        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledOnce
        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.be.calledWith(
          parseEther('10'),
          0,
          [mockWsi.address, mockBusd.address],
          bob.address,
          await getBlockTimestamp()
        )
      })

      it('should not swap if bypass is set to true', async function () {
        // Arrange
        await contract.addFee(...getFeeEntryArgs({ destination: bob.address, percentage: 10000, doSwapForBusd: true, swapOrLiquifyAmount: parseEther('10') })) // 10%
        await mockWsi.connect(alice).transfer(contract.address, parseEther('100'))

        // Act
        await contract.connect(alice).reflectFees(
          mockWsi.address,
          alice.address,
          bob.address,
          parseEther('100'),
          true
        )

        // Assert
        expect(await mockWsi.balanceOf(mockPancakeRouter.address)).to.equal(parseEther('0'))

        const fee = await contract.getFee(0)
        expect(await contract.getFeeAmount(fee.id)).to.equal(parseEther('10'))

        expect(mockPancakeRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens).to.not.be.called
      })
    })

  })

  describe('Emergency Withdraw', function () {
    describe('BNB', function () {
      beforeEach(async function () {
        await ethers.provider.send("hardhat_setBalance", [
          contract.address,
          "0x56BC75E2D63100000",
        ]);
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

    describe('Token', function () {
      beforeEach(async function () {
        await mockWsi.transfer(contract.address, parseEther('100'))
      })

      it('should withdraw all token', async function () {
        // Assert
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.emergencyWithdrawToken(mockWsi.address, parseEther('100'))
        ).to.not.be.reverted

        // Assert
        expect(await mockWsi.balanceOf(owner.address)).to.equal(parseEther('100'))
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('0'))
      })

      it('should withdraw custom amount token', async function () {
        // Assert
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.emergencyWithdrawToken(mockWsi.address, parseEther('10'))
        ).to.not.be.reverted

        // Assert
        expect(await mockWsi.balanceOf(owner.address)).to.equal(parseEther('10'))
        expect(await mockWsi.balanceOf(contract.address)).to.equal(parseEther('90'))
      })

      it('should fail on withdraw if caller is non-owner', async function () {
        await expect(
          contract.connect(alice).emergencyWithdrawToken(mockWsi.address, parseEther('100'))
        ).to.be.reverted
      })
    })
  })

})