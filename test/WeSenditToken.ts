import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { ethers } from 'hardhat'
import { expect } from 'chai'
import { MockERC20, MockPancakeRouter, MockPancakeRouter__factory, MockStakingPool, WeSenditToken } from "../typechain";
import { parseEther } from "ethers/lib/utils";
import { MockContract, smock } from '@defi-wonderland/smock';

describe("WeSendit", function () {
  let token: WeSenditToken;;
  let mockBnb: MockERC20
  let mockPancakeRouter: MockContract<MockPancakeRouter>;
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;
  let supply: SignerWithAddress
  let mockStakingPool: MockStakingPool
  let addrs: SignerWithAddress[];

  let ADMIN_ROLE: string
  let FEE_WHITELIST_ROLE: string
  let BYPASS_PAUSE_ROLE: string
  let RECEIVER_FEE_WHITELIST_ROLE: string
  let BYPASS_SWAP_AND_LIQUIFY_ROLE: string

  const INITIAL_SUPPLY = parseEther('37500000');
  const TOTAL_SUPPLY = parseEther('1500000000');

  beforeEach(async function () {
    const WeSenditToken = await ethers.getContractFactory("WeSenditToken");
    [owner, alice, bob, charlie, supply, ...addrs] = await ethers.getSigners();

    token = await WeSenditToken.deploy(supply.address);

    ADMIN_ROLE = await token.ADMIN()
    FEE_WHITELIST_ROLE = await token.FEE_WHITELIST()
    BYPASS_PAUSE_ROLE = await token.BYPASS_PAUSE()
    RECEIVER_FEE_WHITELIST_ROLE = await token.RECEIVER_FEE_WHITELIST()
    BYPASS_SWAP_AND_LIQUIFY_ROLE = await token.BYPASS_SWAP_AND_LIQUIFY()
  });

  describe("Deployment", function () {
    it("should set the right owner", async function () {
      expect(await token.owner()).to.equal(owner.address);
    });

    it("should assign total supply to wallet", async function () {
      const balance = await token.balanceOf(supply.address);
      expect(balance).to.equal(TOTAL_SUPPLY);
    });

    it("should assign correct initial values", async function () {
      expect(await token.initialSupply()).to.equal(INITIAL_SUPPLY);
      expect(await token.paused()).to.equal(false);
      expect(await token.pancakeRouter()).to.be.properAddress;
      expect(await token.swapAndLiquifyEnabled()).to.equal(false);
      expect(await token.swapAndLiquifyBalance()).to.equal(0);
      expect(await token.feesEnabled()).to.equal(false);
    })

    it("should assign correct roles to creator", async function () {
      expect(await token.hasRole(ADMIN_ROLE, owner.address)).to.equal(true)

      expect(await token.getRoleAdmin(ADMIN_ROLE)).to.equal(ADMIN_ROLE)
      expect(await token.getRoleAdmin(FEE_WHITELIST_ROLE)).to.equal(ADMIN_ROLE)
      expect(await token.getRoleAdmin(BYPASS_PAUSE_ROLE)).to.equal(ADMIN_ROLE)
      expect(await token.getRoleAdmin(RECEIVER_FEE_WHITELIST_ROLE)).to.equal(ADMIN_ROLE)
    })
  });

  describe("Dynamic Fee System", function () {
    describe('Setup', function () {
      it('should add fee as owner', async function () {
        const res = await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, addrs[0].address)

        expect(res.value).to.equal(0)
      })

      it('should fail to add fee as non-owner', async function () {
        await expect(
          token.connect(alice).addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, addrs[0].address)
        ).to.be.reverted
      })

      it('should get fee at index', async function () {
        // Arrange
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, addrs[0].address)

        // Assert
        const fee = await token.getFee(0)
        expect(fee.from).to.equal(ethers.constants.AddressZero)
        expect(fee.to).to.equal(ethers.constants.AddressZero)
        expect(fee.percentage).to.equal(5000)
        expect(fee.destination).to.equal(addrs[0].address)
      })

      it('should remove fee at index as owner', async function () {
        // Arrange
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, addrs[0].address)

        // Assert
        await token.removeFee(0)
      })

      it('should fail to remove fee at index as non-owner', async function () {
        // Arrange
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, addrs[0].address)

        // Assert
        await expect(token.connect(alice).removeFee(0)).to.be.reverted
      })

      it('should fail to remove fee at non existing index', async function () {
        // Assert
        await expect(token.removeFee(0)).to.be.reverted
      })

      it('should remove fee if multiple fees added', async function () {
        // Arrange
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 1, addrs[0].address)
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 2, addrs[0].address)
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 3, addrs[0].address)

        // Assert
        const feeBefore = await token.getFee(1)
        expect(feeBefore.percentage).to.equal(2)

        // Act
        await token.removeFee(1)

        // Assert
        const feeAfter = await token.getFee(1)
        expect(feeAfter.percentage).to.equal(3)
        await expect(token.getFee(2)).to.be.reverted
      })
    })

    describe('Transfers', function () {
      beforeEach(async function () {
        await token.connect(supply).transfer(alice.address, parseEther('100'))
        await token.setFeesEnabled(true)
      })

      it('should apply single fees on transfer', async function () {
        // Arrange
        const feeAddress = addrs[0].address
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, feeAddress)

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(0)

        // Act
        await token.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(parseEther('5'))
        expect(await token.balanceOf(bob.address)).to.equal(parseEther('95'))
      })

      it('should apply multiple fees on transfer', async function () {
        // Arrange
        const feeAddress = addrs[0].address
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, feeAddress)
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 2500, feeAddress)

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(0)

        // Act
        await token.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(parseEther('7.5'))
        expect(await token.balanceOf(bob.address)).to.equal(parseEther('92.5'))
      })

      it('should only apply relevant fees (1)', async function () {
        // Arrange
        const feeAddress = addrs[0].address
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, feeAddress)
        await token.addFee(bob.address, alice.address, 2500, feeAddress)

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(0)

        // Act
        await token.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(parseEther('5'))
        expect(await token.balanceOf(bob.address)).to.equal(parseEther('95'))
      })

      it('should only apply relevant fees (2)', async function () {
        // Arrange
        const feeAddress = addrs[0].address
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, feeAddress)
        await token.addFee(alice.address, bob.address, 2500, feeAddress)

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(0)

        // Act
        await token.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(parseEther('7.5'))
        expect(await token.balanceOf(bob.address)).to.equal(parseEther('92.5'))
      })

      it('should only apply relevant fees (3)', async function () {
        // Arrange
        const feeAddress = addrs[0].address
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, feeAddress)
        await token.addFee(bob.address, alice.address, 2500, feeAddress)
        await token.addFee(alice.address, ethers.constants.AddressZero, 10000, feeAddress)

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(0)

        // Act
        await token.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(parseEther('15'))
        expect(await token.balanceOf(bob.address)).to.equal(parseEther('85'))
      })

      it('should not apply fees if owner', async function () {
        // Arrange
        const feeAddress = addrs[0].address
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, feeAddress)
        await token.transferOwnership(alice.address)

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(0)

        // Act
        await token.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(parseEther('0'))
        expect(await token.balanceOf(bob.address)).to.equal(parseEther('100'))
      })

      it('should not apply fees if admin', async function () {
        // Arrange
        const feeAddress = addrs[0].address
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, feeAddress)
        await token.grantRole(ADMIN_ROLE, alice.address)

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(0)

        // Act
        await token.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(parseEther('0'))
        expect(await token.balanceOf(bob.address)).to.equal(parseEther('100'))
      })

      it('should not apply fees if on whitelist', async function () {
        // Arrange
        const feeAddress = addrs[0].address
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, feeAddress)
        await token.grantRole(FEE_WHITELIST_ROLE, alice.address)

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(0)

        // Act
        await token.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(parseEther('0'))
        expect(await token.balanceOf(bob.address)).to.equal(parseEther('100'))
      })

      it('should not apply fees if receiver is on whitelist', async function () {
        // Arrange
        const feeAddress = addrs[0].address
        await token.addFee(ethers.constants.AddressZero, ethers.constants.AddressZero, 5000, feeAddress)
        await token.grantRole(RECEIVER_FEE_WHITELIST_ROLE, bob.address)

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(0)

        // Act
        await token.connect(alice).transfer(bob.address, parseEther('100'))

        // Assert
        expect(await token.balanceOf(feeAddress)).to.equal(parseEther('0'))
        expect(await token.balanceOf(bob.address)).to.equal(parseEther('100'))
      })
    })

    describe('Staking Pool Callback', function () {
      beforeEach(async function () {
        const MockStakingPool = await ethers.getContractFactory('MockStakingPool')
        mockStakingPool = await MockStakingPool.deploy()

        await token.connect(supply).transfer(alice.address, parseEther('100'))
        await token.setStakingPoolAddress(mockStakingPool.address)
        await token.setFeesEnabled(true)
      })

      it('should call staking pool callback if disabled', async function () {
        // Arrange
        await token.setStakingPoolAddress(ethers.constants.AddressZero)
        await token.addFee(ethers.constants.AddressZero, mockStakingPool.address, 50000, mockStakingPool.address)

        // Act & Assert
        await expect(token.connect(alice).transfer(bob.address, parseEther('10'))).to.not.emit(
          mockStakingPool,
          'ERC20Received'
        )
      })

      it('should call staking pool callback if enabled', async function () {
        // Arrange
        await token.addFee(ethers.constants.AddressZero, mockStakingPool.address, 50000, mockStakingPool.address)

        // Act & Assert
        await expect(token.connect(alice).transfer(bob.address, parseEther('10'))).to.emit(
          mockStakingPool,
          'ERC20Received'
        ).withArgs(alice.address, parseEther('5'))
      })
    })
  })

  describe('Swap And Liquify', function () {
    beforeEach(async function () {
      const MockERC20 = await ethers.getContractFactory('MockERC20')
      mockBnb = await MockERC20.deploy()

      const MockPancakeRouter = await smock.mock<MockPancakeRouter__factory>('MockPancakeRouter')
      mockPancakeRouter = await MockPancakeRouter.deploy(mockBnb.address)

      await token.setPancakeRouter(mockPancakeRouter.address)
      await token.connect(supply).transfer(alice.address, parseEther('100'))
      await token.setSwapAndLiquifyBalance(parseEther('11'))
      await token.setSwapAndLiquifyEnabled(true)
      await token.setFeesEnabled(true)
    })

    it('should not swap and liquify before total token amount is reached', async function () {
      // Arrange
      await token.addFee(alice.address, bob.address, 50000, token.address)

      // Assert
      expect(await token.balanceOf(token.address)).to.equal(0)

      // Act
      await token.connect(alice).transfer(bob.address, parseEther('20'))

      // Assert
      expect(await token.balanceOf(token.address)).to.equal(parseEther('10'))
    })

    it('should not swap and liquify if sender has bypass role', async function () {
      // Arrange
      await token.addFee(alice.address, bob.address, 75000, token.address)
      await token.grantRole(BYPASS_SWAP_AND_LIQUIFY_ROLE, alice.address)

      // Assert
      expect(await token.balanceOf(token.address)).to.equal(0)

      // Act
      await token.connect(alice).transfer(bob.address, parseEther('20'))

      // Assert
      expect(await token.balanceOf(token.address)).to.equal(parseEther('15'))
    })

    it('should swap and liquify if total token amount is reached', async function () {
      // Arrange
      await token.addFee(alice.address, bob.address, 75000, token.address)

      // Assert
      expect(await token.balanceOf(token.address)).to.equal(0)

      // Act
      await token.connect(alice).transfer(bob.address, parseEther('20'))

      // Assert
      mockPancakeRouter.addLiquidityETH.atCall(0).should.be.calledWithValue(
        parseEther('1')
      )
      mockPancakeRouter.addLiquidityETH.atCall(0).should.be.calledWith(
        token.address,
        parseEther('10'),
        0,
        0,
        owner.address
      )
      expect(await token.balanceOf(token.address)).to.equal(parseEther('15'))
    })
  })

  describe('Minimum TX Amount', function () {
    beforeEach(async function () {
      await token.connect(supply).transfer(alice.address, parseEther('100'))
      await token.setMinTxAmount(parseEther('10'))
    })

    it("should transfer if minTxAmount is less than transfer amount", async function () {
      // Act
      await expect(
        token.connect(alice).transfer(bob.address, parseEther('10'))
      ).to.not.be.reverted

      // Assert
      expect(await token.balanceOf(bob.address)).to.equal(parseEther('10'))
    });

    it("should fail if minTxAmount is greater than transfer amount", async function () {
      // Act & Assert
      await expect(
        token.connect(alice).transfer(bob.address, parseEther('9'))
      ).to.be.revertedWith('WeSendit: amount is less than minTxAmount')
    });
  })

  describe('Transaction Pausing', function () {
    beforeEach(async function () {
      await token.connect(supply).transfer(alice.address, parseEther('100'))
      await token.setPaused(true)
    })

    it('should pause all normal transactions', async function () {
      // Act & Assert
      await expect(
        token.connect(alice).transfer(bob.address, parseEther('9'))
      ).to.be.revertedWith('WeSendit: transactions are paused')
    })

    it('should bypass pause if owner', async function () {
      // Arrage
      token.transferOwnership(alice.address)

      // Act & Assert
      await expect(
        token.connect(alice).transfer(bob.address, parseEther('9'))
      ).to.not.be.reverted
    })

    it('should bypass pause if admin', async function () {
      // Arrange
      token.grantRole(ADMIN_ROLE, alice.address)

      // Act & Assert
      await expect(
        token.connect(alice).transfer(bob.address, parseEther('9'))
      ).to.not.be.reverted
    })

    it('should bypass pause if pause bypass role', async function () {
      // Arrange
      token.grantRole(BYPASS_PAUSE_ROLE, alice.address)

      // Act & Assert
      await expect(
        token.connect(alice).transfer(bob.address, parseEther('9'))
      ).to.not.be.reverted
    })
  })

  describe('Emergency Withdraw', function () {
    beforeEach(async function () {
      await token.connect(supply).transfer(token.address, parseEther('100'))
    })

    it('should withdraw all token', async function () {
      // Assert
      expect(await token.balanceOf(token.address)).to.equal(parseEther('100'))

      // Act
      await expect(
        token.emergencyWithdrawToken(parseEther('100'))
      ).to.not.be.reverted

      // Assert
      expect(await token.balanceOf(owner.address)).to.equal(parseEther('100'))
      expect(await token.balanceOf(token.address)).to.equal(parseEther('0'))
    })

    it('should withdraw custom amount token', async function () {
      // Assert
      expect(await token.balanceOf(token.address)).to.equal(parseEther('100'))

      // Act
      await expect(
        token.emergencyWithdrawToken(parseEther('10'))
      ).to.not.be.reverted

      // Assert
      expect(await token.balanceOf(owner.address)).to.equal(parseEther('10'))
      expect(await token.balanceOf(token.address)).to.equal(parseEther('90'))
    })

    it('should fail on withdraw if caller is non-owner', async function () {
      await expect(
        token.connect(alice).emergencyWithdrawToken(parseEther('100'))
      ).to.be.reverted
    })
  })

});