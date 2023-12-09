import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import { ethers, network } from 'hardhat'
import { expect } from 'chai'
import { MockERC20, MultiVestingWallet } from "../typechain";

import moment from 'moment'
import { parseEther } from "ethers/lib/utils";
import { SnapshotRestorer, mine, takeSnapshot, time } from "@nomicfoundation/hardhat-network-helpers";
import { BigNumber } from "ethers";
import { setNextBlockTimestamp } from "@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time";

const getBalanceChange = async (signer: SignerWithAddress, action: Function, delta?: BigNumber): Promise<BigNumber> => {
  const balanceBefore = await signer.getBalance()
  await action()
  const balanceAfter = await signer.getBalance()

  if (delta) {
    return balanceAfter.sub(balanceBefore).sub(delta)
  }

  return balanceAfter.sub(balanceBefore)
}

const getTokenBalanceChange = async (contract: MockERC20, signer: SignerWithAddress, action: Function, delta?: BigNumber): Promise<BigNumber> => {
  const balanceBefore = await contract.balanceOf(signer.address)
  await action()
  const balanceAfter = await contract.balanceOf(signer.address)

  if (delta) {
    return balanceAfter.sub(balanceBefore).sub(delta)
  }

  return balanceAfter.sub(balanceBefore)
}

describe("MultiVestingWallet", function () {
  const TOTAL_VESTING_TIME = 600

  let contract: MultiVestingWallet
  let mockToken: MockERC20

  let start: number
  let snapshot: SnapshotRestorer

  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let charlie: SignerWithAddress

  before(async function () {
    await network.provider.send("hardhat_reset")
  })

  beforeEach(async function () {
    [owner, alice, bob, charlie] = await ethers.getSigners()

    const MockERC20 = await ethers.getContractFactory("MockERC20")
    mockToken = await MockERC20.deploy()

    const MultiVestingWallet = await ethers.getContractFactory("MultiVestingWallet")

    start = moment().add(1, 'minute').unix()
    contract = await MultiVestingWallet.deploy(start, TOTAL_VESTING_TIME)
    snapshot = await takeSnapshot()
  })

  afterEach(async function () {
    snapshot.restore()
  })

  describe("Deployment", function () {
    it("should set correct variables at creation", async function () {
      expect(await contract.start()).to.equal(start)
      expect(await contract.duration()).to.equal(600)
    })
  })

  describe('Add Beneficiaries', function () {
    describe('ETH', function () {
      beforeEach(async function () {
        await ethers.provider.send("hardhat_setBalance", [
          contract.address,
          "0x3635C9ADC5DEA00000",
        ])
      })

      it('should add single beneficiary', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiary(address,uint256)"](alice.address, amount)

        // Assert
        expect(await contract["initial(address)"](alice.address)).to.equal(amount)
      })

      it('should add multiple single beneficiary', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiary(address,uint256)"](alice.address, amount)
        await contract["addBeneficiary(address,uint256)"](bob.address, amount)

        // Assert
        expect(await contract["initial(address)"](alice.address)).to.equal(amount)
        expect(await contract["initial(address)"](bob.address)).to.equal(amount)
      })

      it('should add multiple beneficiary', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiaries(address[],uint256[])"](
          [alice.address, bob.address],
          [amount, amount]
        )

        // Assert
        expect(await contract["initial(address)"](alice.address)).to.equal(amount)
        expect(await contract["initial(address)"](bob.address)).to.equal(amount)
      })

      it('should overwrite beneficiary if already added', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiaries(address[],uint256[])"](
          [alice.address, alice.address],
          [amount, amount]
        )

        // Assert
        expect(await contract["initial(address)"](alice.address)).to.equal(amount)
        expect(await contract["initial(address)"](bob.address)).to.equal(0)
      })

      it('should fail to add beneficiary if caller is not owner', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act & Assert
        await expect(contract.connect(alice)["addBeneficiary(address,uint256)"](
          alice.address, amount
        )).to.be.revertedWith('Ownable: caller is not the owner')

        await expect(contract.connect(alice)["addBeneficiaries(address[],uint256[])"](
          [alice.address, bob.address],
          [amount, amount]
        )).to.be.revertedWith('Ownable: caller is not the owner')
      })
    })

    describe('ERC-20 Token', function () {
      beforeEach(async function () {
        await mockToken.transfer(contract.address, parseEther('1000'))
      })

      it('should add single beneficiary', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiary(address,address,uint256)"](alice.address, mockToken.address, amount)

        // Assert
        expect(await contract["initial(address,address)"](alice.address, mockToken.address)).to.equal(amount)
      })

      it('should add multiple single beneficiary', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiary(address,address,uint256)"](alice.address, mockToken.address, amount)
        await contract["addBeneficiary(address,address,uint256)"](bob.address, mockToken.address, amount)

        // Assert
        expect(await contract["initial(address,address)"](alice.address, mockToken.address)).to.equal(amount)
        expect(await contract["initial(address,address)"](bob.address, mockToken.address)).to.equal(amount)
      })

      it('should add multiple beneficiary', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiaries(address[],address,uint256[])"](
          [alice.address, bob.address],
          mockToken.address,
          [amount, amount]
        )

        // Assert
        expect(await contract["initial(address,address)"](alice.address, mockToken.address)).to.equal(amount)
        expect(await contract["initial(address,address)"](bob.address, mockToken.address)).to.equal(amount)
      })

      it('should overwrite beneficiary if already added', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiaries(address[],address,uint256[])"](
          [alice.address, alice.address],
          mockToken.address,
          [amount, amount]
        )

        // Assert
        expect(await contract["initial(address,address)"](alice.address, mockToken.address)).to.equal(amount)
        expect(await contract["initial(address,address)"](bob.address, mockToken.address)).to.equal(0)
      })

      it('should add beneficiary after first claim', async function () {
        // Arrange
        const amount = parseEther('100')

        await contract["addBeneficiary(address,address,uint256)"](alice.address, mockToken.address, amount)
        await contract["addBeneficiary(address,address,uint256)"](bob.address, mockToken.address, amount)

        // Release token
        await time.increaseTo(start + 300)
        await mine()

        await contract["release(address,address)"](alice.address, mockToken.address)

        expect(await mockToken.balanceOf(alice.address)).to.equal(parseEther('50.333333333333333333'))
        expect(await mockToken.balanceOf(bob.address)).to.equal(parseEther('0'))

        // Assert
        await contract["addBeneficiary(address,address,uint256)"](charlie.address, mockToken.address, amount)
      })

      it('should fail to add beneficiary if caller is not owner', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act & Assert
        await expect(contract.connect(alice)["addBeneficiary(address,address,uint256)"](
          alice.address, mockToken.address, amount
        )).to.be.revertedWith('Ownable: caller is not the owner')

        await expect(contract.connect(alice)["addBeneficiaries(address[],address,uint256[])"](
          [alice.address, bob.address],
          mockToken.address,
          [amount, amount]
        )).to.be.revertedWith('Ownable: caller is not the owner')
      })
    })
  })

  describe('Vesting Calculation', function () {
    describe('ETH', function () {
      beforeEach(async function () {
        await ethers.provider.send("hardhat_setBalance", [
          contract.address,
          "0x3635C9ADC5DEA00000",
        ])
      })

      it('should calculate correct values for single beneficiary', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiary(address,uint256)"](alice.address, amount)

        // Assert
        expect(await contract["vestedAmount(address,uint64)"](alice.address, start)).to.equal(0)
        expect(await contract["vestedAmount(address,uint64)"](alice.address, start + 10)).to.equal(
          amount.mul(10).div(TOTAL_VESTING_TIME)
        )
        expect(await contract["vestedAmount(address,uint64)"](alice.address, start + 30)).to.equal(
          amount.mul(30).div(TOTAL_VESTING_TIME)
        )
        expect(await contract["vestedAmount(address,uint64)"](alice.address, start + 590)).to.equal(
          amount.mul(590).div(TOTAL_VESTING_TIME)
        )
        expect(await contract["vestedAmount(address,uint64)"](alice.address, start + 600)).to.equal(amount)
        expect(await contract["vestedAmount(address,uint64)"](alice.address, start + 1200)).to.equal(amount)
      })

      it('should calculate correct values for multiple beneficiaries', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiary(address,uint256)"](alice.address, amount)
        await contract["addBeneficiary(address,uint256)"](bob.address, amount)

        // Assert
        for (const signer of [alice, bob]) {
          expect(await contract["vestedAmount(address,uint64)"](signer.address, start)).to.equal(0)
          expect(await contract["vestedAmount(address,uint64)"](signer.address, start + 10)).to.equal(
            amount.mul(10).div(TOTAL_VESTING_TIME)
          )
          expect(await contract["vestedAmount(address,uint64)"](signer.address, start + 30)).to.equal(
            amount.mul(30).div(TOTAL_VESTING_TIME)
          )
          expect(await contract["vestedAmount(address,uint64)"](signer.address, start + 590)).to.equal(
            amount.mul(590).div(TOTAL_VESTING_TIME)
          )
          expect(await contract["vestedAmount(address,uint64)"](signer.address, start + 600)).to.equal(amount)
          expect(await contract["vestedAmount(address,uint64)"](signer.address, start + 1200)).to.equal(amount)
        }

        for (const signer of [charlie]) {
          expect(await contract["vestedAmount(address,uint64)"](signer.address, start)).to.equal(0)
          expect(await contract["vestedAmount(address,uint64)"](signer.address, start + 10)).to.equal(0)
          expect(await contract["vestedAmount(address,uint64)"](signer.address, start + 30)).to.equal(0)
          expect(await contract["vestedAmount(address,uint64)"](signer.address, start + 590)).to.equal(0)
          expect(await contract["vestedAmount(address,uint64)"](signer.address, start + 600)).to.equal(0)
          expect(await contract["vestedAmount(address,uint64)"](signer.address, start + 1200)).to.equal(0)
        }
      })

      it('should release correct amount for single beneficiary', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiary(address,uint256)"](alice.address, amount)

        // Assert
        expect(await getBalanceChange(alice, async function () {
          await contract["release(address)"](alice.address)
        })).to.equal(0)

        await setNextBlockTimestamp(start + 10)

        expect(await getBalanceChange(alice, async function () {
          await contract["release(address)"](alice.address)
        })).to.equal(
          amount.mul(10).div(TOTAL_VESTING_TIME)
        )

        await setNextBlockTimestamp(start + 600)

        expect(await getBalanceChange(alice, async function () {
          await contract["release(address)"](alice.address)
        })).to.equal(
          amount.sub(amount.mul(10).div(TOTAL_VESTING_TIME))
        )

        await setNextBlockTimestamp(start + 1200)

        expect(await getBalanceChange(alice, async function () {
          await contract["release(address)"](alice.address)
        })).to.equal(0)
      })

      it('should release correct amount for multiple beneficiaries', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiary(address,uint256)"](alice.address, amount)
        await contract["addBeneficiary(address,uint256)"](bob.address, amount.mul(2))

        // Assert
        expect(await getBalanceChange(alice, async function () {
          await contract["release(address)"](alice.address)
        })).to.equal(0)

        expect(await getBalanceChange(bob, async function () {
          await contract["release(address)"](bob.address)
        })).to.equal(0)

        await setNextBlockTimestamp(start + 10)

        expect(await getBalanceChange(alice, async function () {
          await contract["release(address)"](alice.address)
        })).to.equal(
          amount.mul(10).div(TOTAL_VESTING_TIME)
        )

        await setNextBlockTimestamp(start + 11)

        expect(await getBalanceChange(bob, async function () {
          await contract["release(address)"](bob.address)
        })).to.equal(
          amount.mul(2).mul(11).div(TOTAL_VESTING_TIME)
        )

        await setNextBlockTimestamp(start + 600)

        expect(await getBalanceChange(alice, async function () {
          await contract["release(address)"](alice.address)
        })).to.equal(
          amount.sub(amount.mul(10).div(TOTAL_VESTING_TIME))
        )

        expect(await getBalanceChange(bob, async function () {
          await contract["release(address)"](bob.address)
        })).to.equal(
          amount.mul(2).sub(amount.mul(2).mul(11).div(TOTAL_VESTING_TIME))
        )

        await setNextBlockTimestamp(start + 1200)

        expect(await getBalanceChange(alice, async function () {
          await contract["release(address)"](alice.address)
        })).to.equal(0)

        expect(await getBalanceChange(bob, async function () {
          await contract["release(address)"](bob.address)
        })).to.equal(0)
      })
    })

    describe('ERC-20 Token', function () {
      beforeEach(async function () {
        await mockToken.transfer(contract.address, parseEther('1000'))
      })

      it('should calculate correct values for single beneficiary', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiary(address,address,uint256)"](alice.address, mockToken.address, amount)

        // Assert
        expect(await contract["vestedAmount(address,address,uint64)"](alice.address, mockToken.address, start)).to.equal(0)
        expect(await contract["vestedAmount(address,address,uint64)"](alice.address, mockToken.address, start + 10)).to.equal(
          amount.mul(10).div(TOTAL_VESTING_TIME)
        )
        expect(await contract["vestedAmount(address,address,uint64)"](alice.address, mockToken.address, start + 30)).to.equal(
          amount.mul(30).div(TOTAL_VESTING_TIME)
        )
        expect(await contract["vestedAmount(address,address,uint64)"](alice.address, mockToken.address, start + 590)).to.equal(
          amount.mul(590).div(TOTAL_VESTING_TIME)
        )
        expect(await contract["vestedAmount(address,address,uint64)"](alice.address, mockToken.address, start + 600)).to.equal(amount)
        expect(await contract["vestedAmount(address,address,uint64)"](alice.address, mockToken.address, start + 1200)).to.equal(amount)
      })

      it('should calculate correct values for multiple beneficiaries', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiary(address,address,uint256)"](alice.address, mockToken.address, amount)
        await contract["addBeneficiary(address,address,uint256)"](bob.address, mockToken.address, amount)

        // Assert
        for (const signer of [alice, bob]) {
          expect(await contract["vestedAmount(address,address,uint64)"](signer.address, mockToken.address, start)).to.equal(0)
          expect(await contract["vestedAmount(address,address,uint64)"](signer.address, mockToken.address, start + 10)).to.equal(
            amount.mul(10).div(TOTAL_VESTING_TIME)
          )
          expect(await contract["vestedAmount(address,address,uint64)"](signer.address, mockToken.address, start + 30)).to.equal(
            amount.mul(30).div(TOTAL_VESTING_TIME)
          )
          expect(await contract["vestedAmount(address,address,uint64)"](signer.address, mockToken.address, start + 590)).to.equal(
            amount.mul(590).div(TOTAL_VESTING_TIME)
          )
          expect(await contract["vestedAmount(address,address,uint64)"](signer.address, mockToken.address, start + 600)).to.equal(amount)
          expect(await contract["vestedAmount(address,address,uint64)"](signer.address, mockToken.address, start + 1200)).to.equal(amount)
        }

        for (const signer of [charlie]) {
          expect(await contract["vestedAmount(address,address,uint64)"](signer.address, mockToken.address, start)).to.equal(0)
          expect(await contract["vestedAmount(address,address,uint64)"](signer.address, mockToken.address, start + 10)).to.equal(0)
          expect(await contract["vestedAmount(address,address,uint64)"](signer.address, mockToken.address, start + 30)).to.equal(0)
          expect(await contract["vestedAmount(address,address,uint64)"](signer.address, mockToken.address, start + 590)).to.equal(0)
          expect(await contract["vestedAmount(address,address,uint64)"](signer.address, mockToken.address, start + 600)).to.equal(0)
          expect(await contract["vestedAmount(address,address,uint64)"](signer.address, mockToken.address, start + 1200)).to.equal(0)
        }
      })

      it('should release correct amount for single beneficiary', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiary(address,address,uint256)"](alice.address, mockToken.address, amount)

        // Assert
        expect(await getTokenBalanceChange(mockToken, alice, async function () {
          await contract["release(address,address)"](alice.address, mockToken.address)
        })).to.equal(0)

        await setNextBlockTimestamp(start + 10)

        expect(await getTokenBalanceChange(mockToken, alice, async function () {
          await contract["release(address,address)"](alice.address, mockToken.address)
        })).to.equal(
          amount.mul(10).div(TOTAL_VESTING_TIME)
        )

        await setNextBlockTimestamp(start + 600)

        expect(await getTokenBalanceChange(mockToken, alice, async function () {
          await contract["release(address,address)"](alice.address, mockToken.address)
        })).to.equal(
          amount.sub(amount.mul(10).div(TOTAL_VESTING_TIME))
        )

        await setNextBlockTimestamp(start + 1200)

        expect(await getTokenBalanceChange(mockToken, alice, async function () {
          await contract["release(address,address)"](alice.address, mockToken.address)
        })).to.equal(0)
      })

      it('should release correct amount for multiple beneficiaries', async function () {
        // Arrange
        const amount = parseEther('100')

        // Act
        await contract["addBeneficiary(address,address,uint256)"](alice.address, mockToken.address, amount)
        await contract["addBeneficiary(address,address,uint256)"](bob.address, mockToken.address, amount.mul(2))

        // Assert
        expect(await getTokenBalanceChange(mockToken, alice, async function () {
          await contract["release(address,address)"](alice.address, mockToken.address)
        })).to.equal(0)

        expect(await getTokenBalanceChange(mockToken, bob, async function () {
          await contract["release(address,address)"](bob.address, mockToken.address)
        })).to.equal(0)

        await setNextBlockTimestamp(start + 10)

        expect(await getTokenBalanceChange(mockToken, alice, async function () {
          await contract["release(address,address)"](alice.address, mockToken.address)
        })).to.equal(
          amount.mul(10).div(TOTAL_VESTING_TIME)
        )

        await setNextBlockTimestamp(start + 11)

        expect(await getTokenBalanceChange(mockToken, bob, async function () {
          await contract["release(address,address)"](bob.address, mockToken.address)
        })).to.equal(
          amount.mul(2).mul(11).div(TOTAL_VESTING_TIME)
        )

        await setNextBlockTimestamp(start + 600)

        expect(await getTokenBalanceChange(mockToken, alice, async function () {
          await contract["release(address,address)"](alice.address, mockToken.address)
        })).to.equal(
          amount.sub(amount.mul(10).div(TOTAL_VESTING_TIME))
        )

        expect(await getTokenBalanceChange(mockToken, bob, async function () {
          await contract["release(address,address)"](bob.address, mockToken.address)
        })).to.equal(
          amount.mul(2).sub(amount.mul(2).mul(11).div(TOTAL_VESTING_TIME))
        )

        await setNextBlockTimestamp(start + 1200)

        expect(await getTokenBalanceChange(mockToken, alice, async function () {
          await contract["release(address,address)"](alice.address, mockToken.address)
        })).to.equal(0)

        expect(await getTokenBalanceChange(mockToken, bob, async function () {
          await contract["release(address,address)"](bob.address, mockToken.address)
        })).to.equal(0)
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
    })

    describe('Token', function () {
      beforeEach(async function () {
        await contract.transferOwnership(alice.address)
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
})