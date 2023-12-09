import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import chai from 'chai'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { MockERC20, MockERC20__factory, PaymentProcessor } from "../typechain";
import { parseEther } from "ethers/lib/utils";
import { MockContract, smock } from '@defi-wonderland/smock';
import { emergencyGuardTests } from "./EmergencyGuard";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";

chai.should();
chai.use(smock.matchers);

const getBlockTimestamp = async () => {
  const blockNum = await ethers.provider.getBlockNumber()
  const block = await ethers.provider.getBlock(blockNum)

  return block.timestamp
}

describe.only("PaymentProcessor", function () {
  let contract: PaymentProcessor
  let mockToken: MockContract<MockERC20>

  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let processor: SignerWithAddress

  let ADMIN_ROLE: string
  let PROCESSOR_ROLE: string

  beforeEach(async function () {
    [owner, alice, bob, processor] = await ethers.getSigners()

    const MockERC20 = await smock.mock<MockERC20__factory>('MockERC20')
    mockToken = await MockERC20.deploy()

    const PaymentProcessor = await ethers.getContractFactory("PaymentProcessor");
    contract = await PaymentProcessor.deploy(mockToken.address)

    // Setup permissions
    ADMIN_ROLE = await contract.ADMIN()
    PROCESSOR_ROLE = await contract.PROCESSOR()
    await contract.grantRole(PROCESSOR_ROLE, processor.address)

    await mockToken.transfer(alice.address, parseEther('100'))
    await mockToken.transfer(bob.address, parseEther('100'))
  });

  describe("Deployment", function () {
    it("should set correct values in constructor", async function () {
      expect(await contract.getRoleMember(ADMIN_ROLE, 0)).to.equal(owner.address)

      expect(await contract.getRoleAdmin(ADMIN_ROLE)).to.equal(ADMIN_ROLE)
      expect(await contract.getRoleAdmin(PROCESSOR_ROLE)).to.equal(ADMIN_ROLE)
    })
  });

  describe('Execute payment', function () {
    it('should successfully execute payment', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('100'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(0)

      // Act
      await mockToken.connect(alice).approve(contract.address, parseEther('100'))
      await expect(contract.connect(processor).executePayment(alice.address, parseEther('100')))
        .emit(contract, 'PaymentDone')
        .withArgs(
          anyValue,
          alice.address,
          parseEther('100')
        )

      // Assert
      const blockTimestamp = await getBlockTimestamp()

      expect(await mockToken.balanceOf(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('100'))

      expect(await contract.paymentCount(alice.address)).to.equal(1)

      const lastPayment = await contract.lastPayment(alice.address)
      expect(lastPayment.id).to.be.a('string')
      expect(lastPayment.user).to.equal(alice.address)
      expect(lastPayment.amount).to.equal(parseEther('100'))
      expect(lastPayment.executedAt).to.equal(blockTimestamp)
      expect(lastPayment.isRefunded).to.equal(false)
      expect(lastPayment.refundedAt).to.equal(0)

      const paymentAtIndex = await contract.paymentAtIndex(alice.address, 0)
      expect(paymentAtIndex.id).to.be.a('string')
      expect(paymentAtIndex.user).to.equal(alice.address)
      expect(paymentAtIndex.amount).to.equal(parseEther('100'))
      expect(paymentAtIndex.executedAt).to.equal(blockTimestamp)
      expect(paymentAtIndex.isRefunded).to.equal(false)
      expect(paymentAtIndex.refundedAt).to.equal(0)

      const paymentsByUser = await contract.paymentsByUser(alice.address)
      expect(paymentsByUser).to.have.lengthOf(1)
      expect(paymentsByUser[0].id).to.be.a('string')
      expect(paymentsByUser[0].user).to.equal(alice.address)
      expect(paymentsByUser[0].amount).to.equal(parseEther('100'))
      expect(paymentsByUser[0].executedAt).to.equal(blockTimestamp)
      expect(paymentsByUser[0].isRefunded).to.equal(false)
      expect(paymentsByUser[0].refundedAt).to.equal(0)

      const paymentById = await contract.paymentById(lastPayment.id)
      expect(paymentById.id).to.be.a('string')
      expect(paymentById.user).to.equal(alice.address)
      expect(paymentById.amount).to.equal(parseEther('100'))
      expect(paymentById.executedAt).to.equal(blockTimestamp)
      expect(paymentById.isRefunded).to.equal(false)
      expect(paymentById.refundedAt).to.equal(0)
    })

    it('should fail to execute payment as non-processor', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('100'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(0)

      // Act
      await mockToken.connect(alice).approve(contract.address, parseEther('100'))
      await expect(
        contract.connect(owner).executePayment(alice.address, parseEther('100'))
      ).to.be.reverted
    })

    it('should fail to execute payment if token tranfer fails', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('100'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(0)

      await mockToken.connect(alice).approve(contract.address, parseEther('100'))

      mockToken.transferFrom.returns(false)

      // Act
      await expect(
        contract.connect(processor).executePayment(alice.address, parseEther('100'))
      ).to.be.revertedWith('PaymentProcessor: Token transfer failed')
    })
  })

  describe('Refund payment', function () {
    it('should successfully refund payment', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('100'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(0)

      await mockToken.connect(alice).approve(contract.address, parseEther('100'))
      await contract.connect(processor).executePayment(alice.address, parseEther('100'))

      expect(await mockToken.balanceOf(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('100'))

      const paymentBefore = await contract.paymentAtIndex(alice.address, 0)

      // Act
      await expect(contract.connect(processor).refundPayment(paymentBefore.id))
        .to.emit(contract, 'PaymentRefunded')
        .withArgs(
          paymentBefore.id,
          paymentBefore.user,
          paymentBefore.amount
        )

      const blockTimestamp = await getBlockTimestamp()

      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('100'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(0)

      const paymentAfter = await contract.paymentAtIndex(alice.address, 0)

      expect(paymentAfter.refundedAt).equal(blockTimestamp)
      expect(paymentAfter.isRefunded).equal(true)
    })

    it('should successfully execute multiple payments', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('100'))
      expect(await mockToken.balanceOf(bob.address)).to.equal(parseEther('100'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(0)

      // Act
      await mockToken.connect(alice).approve(contract.address, parseEther('100'))
      await contract.connect(processor).executePayment(alice.address, parseEther('25'))
      await contract.connect(processor).executePayment(alice.address, parseEther('75'))

      await mockToken.connect(bob).approve(contract.address, parseEther('100'))
      await contract.connect(processor).executePayment(bob.address, parseEther('100'))

      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(bob.address)).to.equal(0)
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('200'))

      expect(await contract.paymentCount(alice.address)).to.equal(2)
      expect(await contract.paymentCount(bob.address)).to.equal(1)

      const lastPaymentAlice = await contract.lastPayment(alice.address)
      expect(lastPaymentAlice.id).to.be.a('string')
      expect(lastPaymentAlice.user).to.equal(alice.address)
      expect(lastPaymentAlice.amount).to.equal(parseEther('75'))

      const paymentAtIndex0Alice = await contract.paymentAtIndex(alice.address, 0)
      expect(paymentAtIndex0Alice.id).to.be.a('string')
      expect(paymentAtIndex0Alice.user).to.equal(alice.address)
      expect(paymentAtIndex0Alice.amount).to.equal(parseEther('25'))

      const paymentAtIndex1Alice = await contract.paymentAtIndex(alice.address, 1)
      expect(paymentAtIndex1Alice.id).to.be.a('string')
      expect(paymentAtIndex1Alice.user).to.equal(alice.address)
      expect(paymentAtIndex1Alice.amount).to.equal(parseEther('75'))

      const paymentsByUserAlice = await contract.paymentsByUser(alice.address)
      expect(paymentsByUserAlice).has.lengthOf(2)

      const lastPaymentBob = await contract.lastPayment(bob.address)
      expect(lastPaymentBob.id).to.be.a('string')
      expect(lastPaymentBob.user).to.equal(bob.address)
      expect(lastPaymentBob.amount).to.equal(parseEther('100'))

      const paymentsByUserBob = await contract.paymentsByUser(bob.address)
      expect(paymentsByUserBob).has.lengthOf(1)
    })

    it('should fail to refund payment as non-processor', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('100'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(0)

      await mockToken.connect(alice).approve(contract.address, parseEther('100'))
      await contract.connect(processor).executePayment(alice.address, parseEther('100'))

      expect(await mockToken.balanceOf(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('100'))

      const payment = await contract.paymentAtIndex(alice.address, 0)

      // Act
      await expect(
        contract.connect(owner).refundPayment(payment.id)
      ).to.be.reverted
    })

    it('should fail to refund payment if already refunded', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('100'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(0)

      await mockToken.connect(alice).approve(contract.address, parseEther('100'))
      await contract.connect(processor).executePayment(alice.address, parseEther('100'))

      const payment = await contract.paymentAtIndex(alice.address, 0)

      // Act
      await contract.connect(processor).refundPayment(payment.id)

      await expect(
        contract.connect(processor).refundPayment(payment.id)
      ).to.be.revertedWith('PaymentProcessor: Payment was already refunded')
    })

    it('should fail to refund payment if token tranfer fails', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('100'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(0)

      await mockToken.connect(alice).approve(contract.address, parseEther('100'))
      await contract.connect(processor).executePayment(alice.address, parseEther('100'))

      const payment = await contract.paymentAtIndex(alice.address, 0)

      mockToken.transfer.returns(false)

      // Act
      await expect(
        contract.connect(processor).refundPayment(payment.id)
      ).to.be.revertedWith('PaymentProcessor: Token transfer failed')
    })
  })

  describe('EmergencyGuard', function () {
    emergencyGuardTests<PaymentProcessor>(
      'PaymentProcessor',
      ethers.constants.AddressZero
    )
  })

})