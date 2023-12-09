// SPDX-License-Identifier: MIT
// Based on VestingWallet from OpenZeppelin Contracts (last updated v4.8.0) (finance/VestingWallet.sol)
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "hardhat/console.sol";

interface IMultiVestingWallet {
    event EtherReleased(address indexed beneficiary, uint256 amount);
    event ERC20Released(
        address indexed beneficiary,
        address indexed token,
        uint256 amount
    );

    /**
     * @dev The contract should be able to receive Eth.
     */
    receive() external payable;

    /**
     * @dev Add multiple beneficiaries for ETH.
     */
    function addBeneficiaries(
        address[] calldata beneficiaries,
        uint256[] calldata amounts
    ) external;

    /**
     * @dev Add multiple beneficiaries for token.
     */
    function addBeneficiaries(
        address[] calldata beneficiaries,
        address token,
        uint256[] calldata amounts
    ) external;

    /**
     * @dev Add single beneficiaries for ETH.
     */
    function addBeneficiary(address beneficiary, uint256 amount) external;

    /**
     * @dev Add single beneficiaries for token.
     */
    function addBeneficiary(
        address beneficiary,
        address token,
        uint256 amount
    ) external;

    /**
     * @dev Getter for the start timestamp.
     */
    function start() external view returns (uint256);

    /**
     * @dev Getter for the vesting duration.
     */
    function duration() external view returns (uint256);

    /**
     * @dev Amount of initial eth
     */
    function initial(address beneficiary) external view returns (uint256);

    /**
     * @dev Amount of initial token
     */
    function initial(
        address beneficiary,
        address token
    ) external view returns (uint256);

    /**
     * @dev Amount of eth already released
     */
    function released(address beneficiary) external view returns (uint256);

    /**
     * @dev Amount of token already released
     */
    function released(
        address beneficiary,
        address token
    ) external view returns (uint256);

    /**
     * @dev Getter for the amount of releasable eth.
     */
    function releasable(address beneficiary) external view returns (uint256);

    /**
     * @dev Getter for the amount of releasable `token` tokens. `token` should be the address of an
     * IERC20 contract.
     */
    function releasable(
        address beneficiary,
        address token
    ) external view returns (uint256);

    /**
     * @dev Release the native token (ether) that have already vested.
     *
     * Emits a {EtherReleased} event.
     */
    function release(address beneficiary) external;

    /**
     * @dev Release the tokens that have already vested.
     *
     * Emits a {ERC20Released} event.
     */
    function release(address beneficiary, address token) external;

    /**
     * @dev Calculates the amount of ether that has already vested. Default implementation is a linear vesting curve.
     */
    function vestedAmount(
        address beneficiary,
        uint64 timestamp
    ) external view returns (uint256);

    /**
     * @dev Calculates the amount of tokens that has already vested. Default implementation is a linear vesting curve.
     */
    function vestedAmount(
        address beneficiary,
        address token,
        uint64 timestamp
    ) external view returns (uint256);
}
