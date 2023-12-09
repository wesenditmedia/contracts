import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { parseEther } from "ethers/lib/utils"
import { ethers, network } from "hardhat"
import { AccessControl, EmergencyGuard, MockERC20, MockERC20__factory, MockFeeReceiver, MockNonPayable, MockNonPayable__factory } from "../typechain"
import { MockContract, smock } from "@defi-wonderland/smock"

export function emergencyGuardTests<
  T extends EmergencyGuard & AccessControl & {
    ADMIN: () => Promise<string>
  },
>(
  contractName: string,
  ...contractArgs: any[]
) {
  describe('Emergency Withdraw', function () {
    let contract: T
    let ADMIN_ROLE: string
    let owner: SignerWithAddress
    let alice: SignerWithAddress
    let bob: SignerWithAddress
    let mockToken: MockContract<MockERC20>
    let mockNonPayable: MockContract<MockNonPayable>

    beforeEach(async function () {
      [owner, alice, bob] = await ethers.getSigners()

      const MockERC20 = await smock.mock<MockERC20__factory>('MockERC20')
      mockToken = await MockERC20.deploy()

      const Contract = await ethers.getContractFactory(contractName);
      contract = await Contract.deploy(...contractArgs) as T

      // Setup permissions
      ADMIN_ROLE = await contract.ADMIN()

      const MockNonPayable = await smock.mock<MockNonPayable__factory>('MockNonPayable')
      mockNonPayable = await MockNonPayable.deploy()
    })

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
        await contract.grantRole(ADMIN_ROLE, mockNonPayable.address)

        await ethers.provider.send('hardhat_setBalance', [
          mockNonPayable.address,
          '0x56BC75E2D63100000'
        ])

        await network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [mockNonPayable.address]
        })

        const signer = await ethers.getSigner(mockNonPayable.address);

        // Act & Assert
        await expect(
          contract.connect(signer).emergencyWithdraw(parseEther('100'))
        ).to.be.revertedWith('WeSendit: Failed to send BNB')

        // Reset
        await network.provider.request({
          method: 'hardhat_stopImpersonatingAccount',
          params: [mockNonPayable.address]
        })
      })
    })

    describe('Token', function () {
      beforeEach(async function () {
        await contract.grantRole(ADMIN_ROLE, alice.address)
        await mockToken.transfer(contract.address, parseEther('100'))
      })

      it('should withdraw all token', async function () {
        // Assert
        expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.connect(alice).emergencyWithdrawToken(mockToken.address, parseEther('100'))
        ).to.not.be.reverted

        // Assert
        expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('100'))
        expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('0'))
      })

      it('should withdraw custom amount token', async function () {
        // Assert
        expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('100'))

        // Act
        await expect(
          contract.connect(alice).emergencyWithdrawToken(mockToken.address, parseEther('10'))
        ).to.not.be.reverted

        // Assert
        expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('10'))
        expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('90'))
      })

      it('should fail on withdraw if caller is non-owner', async function () {
        await expect(
          contract.connect(bob).emergencyWithdrawToken(mockToken.address, parseEther('100'))
        ).to.be.reverted
      })
    })
  })
}