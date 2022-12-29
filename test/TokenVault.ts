import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import chai from 'chai'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { MockERC20, TokenVault } from "../typechain";
import { parseEther } from "ethers/lib/utils";
import { smock } from '@defi-wonderland/smock';

chai.should();
chai.use(smock.matchers);

describe("TokenVault", function () {
  let contract: TokenVault
  let mockToken: MockERC20

  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners()

    const TokenVault = await ethers.getContractFactory("TokenVault");
    contract = await TokenVault.deploy()

    const MockERC20 = await ethers.getContractFactory('MockERC20')
    mockToken = await MockERC20.deploy()

    await contract.transferOwnership(alice.address)
  });

  describe("Deployment", function () {
    it("should set the right owner", async function () {
      expect(await contract.owner()).to.equal(alice.address)
    })

    it("should set the initial locking state", async function () {
      expect(await contract.locked()).to.equal(true)
    })
  });

  describe('Vault', function () {
    beforeEach(async function () {
      await contract.connect(alice).unlock()
      await mockToken.transfer(contract.address, parseEther('100'))
    })

    it('should withdraw all token', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('100'))

      // Act
      await expect(
        contract.connect(alice).withdrawToken(mockToken.address, parseEther('100'))
      ).to.not.be.reverted

      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('100'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('0'))
    })

    it('should withdraw custom amount token', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('100'))

      // Act
      await expect(
        contract.connect(alice).withdrawToken(mockToken.address, parseEther('10'))
      ).to.not.be.reverted

      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('10'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('90'))
    })

    it('should withdraw, lock, fail, unlock and withdraw again', async function () {
      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(0)
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('100'))

      // Act
      await expect(
        contract.connect(alice).withdrawToken(mockToken.address, parseEther('10'))
      ).to.not.be.reverted

      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('10'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('90'))

      // Arrange
      await contract.connect(alice).lock()

      // Act
      await expect(
        contract.connect(alice).withdrawToken(mockToken.address, parseEther('100'))
      ).to.be.reverted

      // Arrange
      await contract.connect(alice).unlock()

      // Act
      await expect(
        contract.connect(alice).withdrawToken(mockToken.address, parseEther('10'))
      ).to.not.be.reverted

      // Assert
      expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('20'))
      expect(await mockToken.balanceOf(contract.address)).to.equal(parseEther('80'))
    })

    it('should fail on withdraw if vault is locked', async function () {
      // Arrange
      await contract.connect(alice).lock()

      // Act & Assert
      await expect(
        contract.connect(alice).withdrawToken(mockToken.address, parseEther('100'))
      ).to.be.revertedWith('TokenVault: Token vault is locked')
    })

    it('should fail on withdraw if caller is non-owner', async function () {
      // Act & Assert
      await expect(
        contract.connect(bob).withdrawToken(mockToken.address, parseEther('100'))
      ).to.be.reverted
    })
  })

})